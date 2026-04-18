import { createAdminClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { fetchNRSDailyStats, parseNRSStatsToDailySales } from '@/lib/nrs-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 9:00 AM UTC = ~3 AM CST / 4 AM CDT
// vercel.json: { "path": "/api/cron/nrs-sync", "schedule": "0 9 * * *" }

function yesterdayCentral() {
  const now = new Date();
  // America/Chicago offset: CST = UTC-6, CDT = UTC-5
  const central = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  central.setDate(central.getDate() - 1);
  const y = central.getFullYear();
  const m = String(central.getMonth() + 1).padStart(2, '0');
  const d = String(central.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function runSync(supabase, targetDate) {
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
        results.push({ store: store.name, date: targetDate, status: 'skipped', message: 'Already exists' });
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

      results.push({ store: store.name, date: targetDate, status: 'created', message: `Gross: $${parsed.r1_gross}` });
      created++;
      console.log(`[nrs-cron] ${store.name} ${targetDate} — created (gross $${parsed.r1_gross})`);
    } catch (e) {
      const msg = e.message || String(e);
      results.push({ store: store.name, date: targetDate, status: 'failed', message: msg });
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

  const summary = { date: targetDate, total_stores: (stores || []).length, created, skipped, failed, results };
  console.log(`[nrs-cron] done: ${created} created, ${skipped} skipped, ${failed} failed`);

  if (failed > 0) {
    console.error(`[nrs-cron] WARNING: ${failed} store(s) failed to sync for ${targetDate}`);
    await sendFailureEmail(failed, results.filter(r => r.status === 'failed'));
  }

  return summary;
}

async function sendFailureEmail(failedCount, failedResults) {
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
        text: `NRS Auto-Sync failed for:\n\n${failedResults.map(r => `${r.store} (${r.date}): ${r.message}`).join('\n')}`,
      }),
    });
    console.log('[nrs-cron] failure email sent');
  } catch (e) {
    console.warn('[nrs-cron] email send failed (non-fatal):', e.message);
  }
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const isAuthed = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !isAuthed && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const targetDate = yesterdayCentral();
    const summary = await runSync(supabase, targetDate);
    return NextResponse.json(summary);
  } catch (e) {
    console.error('[nrs-cron] fatal error:', e);
    return NextResponse.json({ error: e.message || 'Cron failed' }, { status: 500 });
  }
}
