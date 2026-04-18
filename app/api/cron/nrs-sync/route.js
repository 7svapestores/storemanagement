import { createAdminClient, createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { fetchNRSDailyStats, parseNRSStatsToDailySales } from '@/lib/nrs-client';

export const dynamic = 'force-dynamic';

// 9:00 AM UTC = ~3 AM CST / 4 AM CDT
// vercel.json: { "path": "/api/cron/nrs-sync", "schedule": "0 9 * * *" }
// Also callable from cron-job.org with Authorization: Bearer <CRON_SECRET>

function yesterdayCentral() {
  const now = new Date();
  const central = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  central.setDate(central.getDate() - 1);
  const y = central.getFullYear();
  const m = String(central.getMonth() + 1).padStart(2, '0');
  const d = String(central.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function runSync(supabase, targetDate) {
  const startMs = Date.now();
  console.log('[nrs-cron] syncing date:', targetDate);
  const { data: stores } = await supabase
    .from('stores')
    .select('id, name, nrs_store_id')
    .not('nrs_store_id', 'is', null)
    .order('created_at');

  const results = [];
  let created = 0, skipped = 0, failed = 0;

  for (const store of (stores || [])) {
    try {
      const { data: existing } = await supabase
        .from('daily_sales')
        .select('id')
        .eq('store_id', store.id)
        .eq('date', targetDate)
        .maybeSingle();

      if (existing) {
        results.push({ store_name: store.name, status: 'skipped', daily_sales_id: existing.id, error: null });
        skipped++;
        console.log(`[nrs-cron] ${store.name} ${targetDate} — skipped (exists)`);
        continue;
      }

      const nrsData = await fetchNRSDailyStats(store.nrs_store_id, targetDate);
      const parsed = parseNRSStatsToDailySales(nrsData, store.id, targetDate);

      const { data: inserted, error } = await supabase
        .from('daily_sales')
        .insert(parsed)
        .select()
        .single();
      if (error) throw error;

      await supabase.from('nrs_sync_log').insert({
        store_id: store.id,
        sync_date: targetDate,
        status: 'success',
        nrs_response: nrsData,
        created_daily_sales_id: inserted.id,
      });

      await supabase.from('activity_log').insert({
        action: 'create',
        entity_type: 'daily_sales',
        entity_id: inserted.id,
        description: `7S Agent synced daily sales for ${store.name} on ${targetDate} ($${parsed.r1_net} net)`,
        user_name: '7S Agent',
        user_role: 'system',
        store_name: store.name,
      }).catch(() => {});

      results.push({ store_name: store.name, status: 'created', daily_sales_id: inserted.id, error: null });
      created++;
      console.log(`[nrs-cron] ${store.name} ${targetDate} — created (gross $${parsed.r1_gross})`);
    } catch (e) {
      const msg = e.message || String(e);
      results.push({ store_name: store.name, status: 'failed', daily_sales_id: null, error: msg });
      failed++;
      console.error(`[nrs-cron] ${store.name} ${targetDate} — FAILED:`, msg);

      await supabase.from('nrs_sync_log').insert({
        store_id: store.id,
        sync_date: targetDate,
        status: 'failed',
        error_message: msg,
      }).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 500));
  }

  const durationMs = Date.now() - startMs;
  console.log(`[nrs-cron] done in ${durationMs}ms: ${created} created, ${skipped} skipped, ${failed} failed`);

  if (failed > 0) {
    console.error(`[nrs-cron] WARNING: ${failed} store(s) failed to sync for ${targetDate}`);
    await sendFailureEmail(failed, results.filter(r => r.status === 'failed'), targetDate);
  }

  return {
    success: failed === 0,
    date_synced: targetDate,
    summary: { total_stores: (stores || []).length, created, skipped, failed },
    results,
    duration_ms: durationMs,
  };
}

async function sendFailureEmail(failedCount, failedResults, date) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'StoreWise <noreply@7sstores.com>',
        to: 'admin@7sstores.com',
        subject: `NRS Sync Alert — ${failedCount} store(s) failed`,
        text: `NRS Auto-Sync failed for ${date}:\n\n${failedResults.map(r => `${r.store_name}: ${r.error}`).join('\n')}`,
      }),
    });
    console.log('[nrs-cron] failure email sent');
  } catch (e) {
    console.warn('[nrs-cron] email send failed (non-fatal):', e.message);
  }
}

async function handleSync(request) {
  // Auth: Bearer token OR Vercel Cron header OR logged-in owner
  const authHeader = request.headers.get('authorization');
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const isBearer = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  let isOwnerUser = false;
  if (!isVercelCron && !isBearer) {
    try {
      const userSupa = createClient();
      const { data: { user } } = await userSupa.auth.getUser();
      if (user) {
        const admin = createAdminClient();
        const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
        isOwnerUser = profile?.role === 'owner';
      }
    } catch {}
  }

  if (!isVercelCron && !isBearer && !isOwnerUser && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const dateParam = url.searchParams.get('date');
    const targetDate = dateParam || yesterdayCentral();

    const supabase = createAdminClient();
    const result = await runSync(supabase, targetDate);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[nrs-cron] fatal error:', e);
    return NextResponse.json({ error: e.message || 'Cron failed', success: false }, { status: 500 });
  }
}

export async function GET(request) { return handleSync(request); }
export async function POST(request) { return handleSync(request); }
