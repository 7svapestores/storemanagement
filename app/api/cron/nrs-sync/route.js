import { createAdminClient, createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { fetchNRSDailyStats, parseNRSStatsToDailySales } from '@/lib/nrs-client';
import { extractShiftsFromNRS } from '@/lib/extract-shifts';
import { sendTelegram, buildSyncSummaryMessage, formatCurrency } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

function yesterdayCentral() {
  const now = new Date();
  const central = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  central.setDate(central.getDate() - 1);
  const y = central.getFullYear();
  const m = String(central.getMonth() + 1).padStart(2, '0');
  const d = String(central.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function syncOneStore(supabase, store, targetDate) {
  const t0 = Date.now();

  const { data: existing } = await supabase
    .from('daily_sales')
    .select('id')
    .eq('store_id', store.id)
    .eq('date', targetDate)
    .maybeSingle();

  if (existing) {
    console.log(`[nrs-cron] ${store.name} ${targetDate} — skipped (exists) [${Date.now() - t0}ms]`);
    return { store_name: store.name, status: 'skipped', daily_sales_id: existing.id, error: null, ms: Date.now() - t0 };
  }

  const nrsData = await fetchNRSDailyStats(store.nrs_store_id, targetDate);
  const parsed = parseNRSStatsToDailySales(nrsData, store.id, targetDate);

  const { data: inserted, error: insertErr } = await supabase
    .from('daily_sales')
    .insert(parsed)
    .select()
    .single();
  if (insertErr) throw insertErr;

  const { error: logErr } = await supabase.from('nrs_sync_log').insert({
    store_id: store.id,
    sync_date: targetDate,
    status: 'success',
    nrs_response: nrsData,
    created_daily_sales_id: inserted.id,
  });
  if (logErr) console.warn(`[nrs-cron] sync_log insert failed for ${store.name}:`, logErr.message);

  const { error: actErr } = await supabase.from('activity_log').insert({
    action: 'create',
    entity_type: 'daily_sales',
    entity_id: inserted.id,
    description: `7S Agent synced daily sales for ${store.name} on ${targetDate} ($${parsed.r1_net} net)`,
    user_name: '7S Agent',
    user_role: 'system',
    store_name: store.name,
  });
  if (actErr) console.warn(`[nrs-cron] activity_log insert failed for ${store.name}:`, actErr.message);

  await extractShiftsFromNRS(supabase, nrsData, store.id, targetDate, inserted.id);

  console.log(`[nrs-cron] ${store.name} ${targetDate} — created (gross $${parsed.r1_gross}) [${Date.now() - t0}ms]`);
  return { store_name: store.name, status: 'created', daily_sales_id: inserted.id, error: null, ms: Date.now() - t0 };
}

async function runSync(supabase, targetDate) {
  const startMs = Date.now();
  console.log('[nrs-cron] syncing date:', targetDate);

  const { data: stores } = await supabase
    .from('stores')
    .select('id, name, nrs_store_id')
    .not('nrs_store_id', 'is', null)
    .order('created_at');

  if (!stores?.length) {
    console.log('[nrs-cron] no stores with NRS IDs');
    return { success: true, date_synced: targetDate, summary: { total_stores: 0, created: 0, skipped: 0, failed: 0 }, results: [], duration_ms: Date.now() - startMs };
  }

  // Run all stores in parallel
  const settled = await Promise.allSettled(
    stores.map(store => syncOneStore(supabase, store, targetDate))
  );

  const results = [];
  let created = 0, skipped = 0, failed = 0;

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    if (outcome.status === 'fulfilled') {
      const r = outcome.value;
      results.push(r);
      if (r.status === 'created') created++;
      else if (r.status === 'skipped') skipped++;
    } else {
      const store = stores[i];
      const msg = outcome.reason?.message || String(outcome.reason);
      results.push({ store_name: store.name, status: 'failed', daily_sales_id: null, error: msg });
      failed++;
      console.error(`[nrs-cron] ${store.name} ${targetDate} — FAILED:`, msg);

      const { error: logErr } = await supabase.from('nrs_sync_log').insert({
        store_id: store.id,
        sync_date: targetDate,
        status: 'failed',
        error_message: msg,
      });
      if (logErr) console.warn(`[nrs-cron] sync_log (fail) insert failed:`, logErr.message);
    }
  }

  const durationMs = Date.now() - startMs;
  console.log(`[nrs-cron] done in ${durationMs}ms: ${created} created, ${skipped} skipped, ${failed} failed`);

  if (failed > 0) {
    console.error(`[nrs-cron] WARNING: ${failed} store(s) failed to sync for ${targetDate}`);
    await sendFailureEmail(failed, results.filter(r => r.status === 'failed'), targetDate);
  }

  // Check short/over for all stores on this date and send Telegram notification
  const shortOverAlerts = await checkShortOver(supabase, stores, targetDate);
  try {
    const msg = buildSyncSummaryMessage(results, targetDate, shortOverAlerts);
    await sendTelegram(msg);
  } catch (e) {
    console.warn('[nrs-cron] telegram notification failed (non-fatal):', e.message);
  }

  return {
    success: failed === 0,
    date_synced: targetDate,
    summary: { total_stores: stores.length, created, skipped, failed },
    results,
    duration_ms: durationMs,
    short_over_alerts: shortOverAlerts.length,
  };
}

async function checkShortOver(supabase, stores, targetDate) {
  const alerts = [];
  try {
    const { data: sales } = await supabase
      .from('daily_sales')
      .select('store_id, r1_safe_drop, r2_safe_drop')
      .eq('date', targetDate);
    const { data: cash } = await supabase
      .from('cash_collections')
      .select('store_id, cash_collected')
      .eq('date', targetDate);
    if (!sales?.length || !cash?.length) return alerts;

    const expectedMap = {};
    sales.forEach(s => {
      expectedMap[s.store_id] = (expectedMap[s.store_id] || 0) + (s.r1_safe_drop || 0) + (s.r2_safe_drop || 0);
    });
    const collectedMap = {};
    cash.forEach(c => {
      collectedMap[c.store_id] = (collectedMap[c.store_id] || 0) + (c.cash_collected || 0);
    });

    for (const storeId of Object.keys(collectedMap)) {
      const expected = expectedMap[storeId] || 0;
      const collected = collectedMap[storeId] || 0;
      const diff = +(collected - expected).toFixed(2);
      if (Math.abs(diff) >= 0.01) {
        const store = stores.find(s => s.id === storeId);
        alerts.push({ store_name: store?.name || storeId, expected, collected, diff });
      }
    }
  } catch (e) {
    console.warn('[nrs-cron] checkShortOver failed (non-fatal):', e.message);
  }
  return alerts;
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
