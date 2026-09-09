import { createAdminClient, createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { fetchNRSDailyStats, parseNRSStatsToDailySales, pickNrsOwnedFields, validateNRSAuth } from '@/lib/nrs-client';
import { extractShiftsFromNRS } from '@/lib/extract-shifts';
import { sendTelegram, buildSyncSummaryMessage } from '@/lib/telegram';

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

// All stores share one NRS merchant token. Firing every store's request at
// once is what produced the log pattern where all five failed in the same
// second; a small pool keeps the sync well inside the cron's time budget
// while giving NRS room to breathe.
const NRS_CONCURRENCY = 2;

// How many recent days a run will re-attempt for stores whose last log entry
// is a failure. The cron fires once a day, so without this a transient NRS
// outage leaves a permanent hole in the sales data.
const RETRY_LOOKBACK_DAYS = 7;

// Promise.allSettled semantics (never rejects, results stay in input order)
// but with at most `limit` tasks in flight.
async function mapWithConcurrency(items, limit, fn) {
  const settled = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        settled[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (reason) {
        settled[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return settled;
}

function isoDaysAgo(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Store/date pairs whose most recent log entry is a failure — i.e. still
// unresolved. A later success for the same pair clears it.
async function findUnresolvedFailures(supabase, targetDate) {
  const since = isoDaysAgo(targetDate, RETRY_LOOKBACK_DAYS);
  const { data, error } = await supabase
    .from('nrs_sync_log')
    .select('store_id, sync_date, status, created_at')
    .gte('sync_date', since)
    .lt('sync_date', targetDate)
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('[nrs-cron] could not read sync history for retry:', error.message);
    return [];
  }

  const latest = new Map();
  for (const row of data || []) latest.set(`${row.store_id}|${row.sync_date}`, row.status);
  return [...latest.entries()]
    .filter(([, status]) => status === 'failed')
    .map(([key]) => {
      const [store_id, sync_date] = key.split('|');
      return { store_id, sync_date };
    });
}

// The failure row matters more than the detail attached to it: if
// `error_detail` isn't there yet (migration not applied on this database),
// fall back to the plain row rather than losing the log entry entirely.
async function insertSyncFailure(supabase, row) {
  const { error } = await supabase.from('nrs_sync_log').insert(row);
  if (!error) return;
  const { error_detail, ...withoutDetail } = row;
  const retry = await supabase.from('nrs_sync_log').insert(withoutDetail);
  if (retry.error) console.warn('[nrs-cron] sync_log (fail) insert failed:', retry.error.message);
}

async function syncOneStore(supabase, store, targetDate) {
  const t0 = Date.now();

  const { data: existing } = await supabase
    .from('daily_sales')
    .select('id, r1_gross, r1_net, gross_sales, net_sales, cash_sales, card_sales, tax_collected, r1_sales_tax, r1_safe_drop, r2_safe_drop, r2_gross, short_over, r1_short_over, r2_short_over')
    .eq('store_id', store.id)
    .eq('date', targetDate)
    .maybeSingle();

  const nrsData = await fetchNRSDailyStats(store.nrs_store_id, targetDate);
  const parsed = parseNRSStatsToDailySales(nrsData, store.id, targetDate);

  if (existing) {
    const nrsFields = pickNrsOwnedFields(parsed);

    const { data: updated, error: updateErr } = await supabase
      .from('daily_sales')
      .update(nrsFields)
      .eq('id', existing.id)
      .select()
      .single();
    if (updateErr) throw updateErr;

    const { error: logErr } = await supabase.from('nrs_sync_log').insert({
      store_id: store.id,
      sync_date: targetDate,
      status: 'success',
      nrs_response: nrsData,
      created_daily_sales_id: existing.id,
    });
    if (logErr) console.warn(`[nrs-cron] sync_log insert failed for ${store.name}:`, logErr.message);

    const { error: actErr } = await supabase.from('activity_log').insert({
      action: 'update',
      entity_type: 'daily_sales',
      entity_id: existing.id,
      description: `7S Agent merged NRS R1 data into existing daily sales for ${store.name} on ${targetDate} ($${parsed.r1_net} net) — preserved employee-entered R2 / house account`,
      user_name: '7S Agent',
      user_role: 'system',
      store_name: store.name,
    });
    if (actErr) console.warn(`[nrs-cron] activity_log insert failed for ${store.name}:`, actErr.message);

    await extractShiftsFromNRS(supabase, nrsData, store.id, targetDate, existing.id);

    console.log(`[nrs-cron] ${store.name} ${targetDate} — updated (gross $${parsed.r1_gross}) [${Date.now() - t0}ms]`);
    return { store_name: store.name, status: 'updated', daily_sales_id: existing.id, error: null, ms: Date.now() - t0, salesData: updated };
  }

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
  return { store_name: store.name, status: 'created', daily_sales_id: inserted.id, error: null, ms: Date.now() - t0, salesData: inserted };
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
    return { success: true, date_synced: targetDate, summary: { total_stores: 0, created: 0, updated: 0, skipped: 0, failed: 0 }, results: [], duration_ms: Date.now() - startMs };
  }

  // Two at a time, not all five at once. Every store shares a single merchant
  // token, and hammering NRS with a simultaneous burst is a plausible cause of
  // the empty-bodied 500s that failed every store in the same second.
  const settled = await mapWithConcurrency(
    stores, NRS_CONCURRENCY, store => syncOneStore(supabase, store, targetDate)
  );

  const results = [];
  const failures = [];
  let created = 0, updated = 0, skipped = 0, failed = 0;

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    if (outcome.status === 'fulfilled') {
      const r = outcome.value;
      results.push(r);
      if (r.status === 'created') created++;
      else if (r.status === 'updated') updated++;
      else if (r.status === 'skipped') skipped++;
    } else {
      const store = stores[i];
      const msg = outcome.reason?.message || String(outcome.reason);
      const detail = outcome.reason?.detail || null;
      results.push({ store_name: store.name, status: 'failed', daily_sales_id: null, error: msg, detail });
      failed++;
      failures.push({ store, msg, detail });
      console.error(`[nrs-cron] ${store.name} ${targetDate} — FAILED:`, msg);
    }
  }

  // When every store fails there is one shared cause — the token or NRS
  // itself — so diagnose it once and put the answer in each log row, rather
  // than repeating a bare status code five times.
  let sharedNote = '';
  if (failures.length && failures.length === stores.length) {
    const { valid } = await validateNRSAuth().catch(() => ({ valid: null }));
    if (valid === false) sharedNote = ' [All stores failed and the NRS token is NOT valid — set a fresh NRS_USER_TOKEN, then re-run the sync.]';
    else if (valid === true) sharedNote = ' [All stores failed but the NRS token is valid — NRS-side outage. The next run will automatically retry this date.]';
  }

  for (const { store, msg, detail } of failures) {
    await insertSyncFailure(supabase, {
      store_id: store.id,
      sync_date: targetDate,
      status: 'failed',
      error_message: `${msg}${sharedNote}`,
      error_detail: detail,
    });
  }

  const durationMs = Date.now() - startMs;
  console.log(`[nrs-cron] done in ${durationMs}ms: ${created} created, ${updated} updated, ${skipped} skipped, ${failed} failed`);

  if (failed > 0) {
    console.error(`[nrs-cron] WARNING: ${failed} store(s) failed to sync for ${targetDate}`);
    await sendFailureEmail(failed, results.filter(r => r.status === 'failed'), targetDate);
  }

  // Heal earlier days that are still failed. Without this a single NRS blip
  // leaves a permanent hole, because the cron only ever looks at yesterday.
  // Skipped when the token itself is bad — retrying would just fail again.
  const recovery = sharedNote.includes('NOT valid')
    ? { attempted: 0, recovered: 0 }
    : await retryUnresolved(supabase, stores, targetDate);

  // Check short/over and send ONE comprehensive Telegram message to owner
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
    summary: { total_stores: stores.length, created, updated, skipped, failed },
    results,
    duration_ms: durationMs,
    short_over_alerts: shortOverAlerts.length,
    recovery,
  };
}

// Re-run the stores/dates whose most recent log entry is still a failure.
// Capped so one bad week can't blow the cron's execution limit.
const MAX_RETRIES_PER_RUN = 12;

async function retryUnresolved(supabase, stores, targetDate) {
  const storeById = new Map(stores.map(st => [st.id, st]));
  const pending = (await findUnresolvedFailures(supabase, targetDate))
    .filter(f => storeById.has(f.store_id))
    .slice(0, MAX_RETRIES_PER_RUN);

  if (!pending.length) return { attempted: 0, recovered: 0 };
  console.log(`[nrs-cron] retrying ${pending.length} unresolved failure(s) from the last ${RETRY_LOOKBACK_DAYS} days`);

  const settled = await mapWithConcurrency(pending, NRS_CONCURRENCY,
    f => syncOneStore(supabase, storeById.get(f.store_id), f.sync_date));

  let recovered = 0;
  for (let i = 0; i < settled.length; i++) {
    const { store_id, sync_date } = pending[i];
    const store = storeById.get(store_id);
    if (settled[i].status === 'fulfilled') {
      recovered++;
      console.log(`[nrs-cron] recovered ${store.name} ${sync_date}`);
      continue;
    }
    const reason = settled[i].reason;
    const msg = reason?.message || String(reason);
    console.warn(`[nrs-cron] retry still failing: ${store.name} ${sync_date} — ${msg}`);
    await insertSyncFailure(supabase, {
      store_id,
      sync_date,
      status: 'failed',
      error_message: `Retry failed: ${msg}`,
      error_detail: reason?.detail || null,
    });
  }
  return { attempted: pending.length, recovered };
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
