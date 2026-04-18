import { createClient, createAdminClient } from '@/lib/supabase-server';
import { fetchNRSDailyStats, parseNRSStatsToDailySales } from '@/lib/nrs-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function dateRange(start, end) {
  const dates = [];
  const cur = new Date(start + 'T12:00:00');
  const last = new Date(end + 'T12:00:00');
  while (cur <= last) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

export async function POST(req) {
  // Auth
  let userId;
  try {
    const userSupa = createClient();
    const { data: { user }, error } = await userSupa.auth.getUser();
    if (error || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    userId = user.id;
  } catch {
    return new Response(JSON.stringify({ error: 'Auth failed' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin.from('profiles').select('id, name, role').eq('id', userId).single();
  if (profile?.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'Owner access required' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { store_ids, start_date, end_date } = body;
  if (!store_ids?.length || !start_date || !end_date) {
    return new Response(JSON.stringify({ error: 'store_ids, start_date, end_date required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { data: storesData } = await admin.from('stores').select('id, name, nrs_store_id').in('id', store_ids);
  const storesWithNrs = (storesData || []).filter(s => s.nrs_store_id);
  const dates = dateRange(start_date, end_date);

  const tasks = [];
  for (const store of storesWithNrs) {
    for (const date of dates) {
      tasks.push({ store, date });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      let created = 0, skipped = 0, failed = 0;

      for (let i = 0; i < tasks.length; i++) {
        const { store, date } = tasks[i];
        const taskStart = Date.now();
        try {
          const { data: existing } = await admin
            .from('daily_sales').select('id')
            .eq('store_id', store.id).eq('date', date)
            .maybeSingle();

          if (existing) {
            skipped++;
            send('progress', { current: i + 1, total: tasks.length, store: store.name, date, status: 'skipped', duration_ms: Date.now() - taskStart });
            continue;
          }

          const nrsData = await fetchNRSDailyStats(store.nrs_store_id, date);
          const parsed = parseNRSStatsToDailySales(nrsData, store.id, date);
          parsed.entered_by = userId;

          const { data: inserted, error } = await admin.from('daily_sales').insert(parsed).select().single();
          if (error) throw error;

          const { error: logErr } = await admin.from('nrs_sync_log').insert({
            store_id: store.id, sync_date: date, status: 'success',
            nrs_response: nrsData, created_daily_sales_id: inserted.id, synced_by: userId,
          });
          if (logErr) console.warn('[backfill] sync_log insert failed:', logErr.message);

          created++;
          send('progress', { current: i + 1, total: tasks.length, store: store.name, date, status: 'created', gross: parsed.r1_gross, duration_ms: Date.now() - taskStart });
        } catch (e) {
          failed++;
          send('progress', { current: i + 1, total: tasks.length, store: store.name, date, status: 'failed', error: e.message || 'Unknown', duration_ms: Date.now() - taskStart });

          const { error: fLogErr } = await admin.from('nrs_sync_log').insert({
            store_id: store.id, sync_date: date, status: 'failed',
            error_message: e.message, synced_by: userId,
          });
          if (fLogErr) console.warn('[backfill] sync_log (fail) insert failed:', fLogErr.message);
        }

        await new Promise(r => setTimeout(r, 100));
      }

      send('complete', { total: tasks.length, created, skipped, failed });

      const { error: actErr } = await admin.from('activity_log').insert({
        action: 'create', entity_type: 'nrs_backfill',
        description: `7S Agent backfill: ${created} created, ${skipped} skipped, ${failed} failed (${start_date} to ${end_date})`,
        user_id: userId, user_name: profile.name, user_role: profile.role,
      });
      if (actErr) console.warn('[backfill] activity_log insert failed:', actErr.message);

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
