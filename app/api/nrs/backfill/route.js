import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase-server';
import { fetchNRSDailyStats, parseNRSStatsToDailySales } from '@/lib/nrs-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  try {
    const userSupa = createClient();
    const { data: { user }, error: authErr } = await userSupa.auth.getUser();
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminClient();
    const { data: profile } = await admin.from('profiles').select('id, name, role').eq('id', user.id).single();
    if (profile?.role !== 'owner') return NextResponse.json({ error: 'Owner access required' }, { status: 403 });

    const { store_ids, start_date, end_date, batch_size = 10, cursor = 0 } = await req.json();
    if (!store_ids?.length || !start_date || !end_date) {
      return NextResponse.json({ error: 'store_ids, start_date, end_date are required' }, { status: 400 });
    }

    const { data: storesData } = await admin.from('stores').select('id, name, nrs_store_id').in('id', store_ids);
    const storesWithNrs = (storesData || []).filter(s => s.nrs_store_id);
    const dates = dateRange(start_date, end_date);

    // Build full task list
    const tasks = [];
    for (const store of storesWithNrs) {
      for (const date of dates) {
        tasks.push({ store, date });
      }
    }

    const batch = tasks.slice(cursor, cursor + batch_size);
    const results = [];
    let created = 0, skipped = 0, failed = 0;

    for (const { store, date } of batch) {
      try {
        const { data: existing } = await admin.from('daily_sales').select('id').eq('store_id', store.id).eq('date', date).maybeSingle();
        if (existing) {
          results.push({ store: store.name, date, status: 'skipped', message: 'Already exists' });
          skipped++;
          continue;
        }

        const nrsData = await fetchNRSDailyStats(store.nrs_store_id, date);
        const parsed = parseNRSStatsToDailySales(nrsData, store.id, date);
        parsed.entered_by = user.id;

        const { data: inserted, error } = await admin.from('daily_sales').insert(parsed).select().single();
        if (error) throw error;

        const expectedCash = (parsed.r1_safe_drop || 0) + (parsed.r2_safe_drop || 0);
        await admin.from('cash_collections').upsert(
          { store_id: store.id, date, expected_amount: expectedCash },
          { onConflict: 'store_id,date', ignoreDuplicates: false }
        );

        await admin.from('nrs_sync_log').insert({
          store_id: store.id, sync_date: date, status: 'success',
          created_daily_sales_id: inserted.id, synced_by: user.id,
        });

        results.push({ store: store.name, date, status: 'created', message: `Gross: $${parsed.r1_gross}` });
        created++;
      } catch (e) {
        results.push({ store: store.name, date, status: 'failed', message: e.message || 'Unknown error' });
        await admin.from('nrs_sync_log').insert({
          store_id: store.id, sync_date: date, status: 'failed',
          error_message: e.message, synced_by: user.id,
        }).catch(() => {});
        failed++;
      }
      await new Promise(r => setTimeout(r, 150));
    }

    const cursorNext = cursor + batch.length;
    const hasMore = cursorNext < tasks.length;

    // Log activity on final batch
    if (!hasMore && (created > 0 || failed > 0)) {
      await admin.from('activity_log').insert({
        action: 'create', entity_type: 'nrs_backfill',
        description: `7S Agent backfill batch completed: ${created} created, ${skipped} skipped, ${failed} failed`,
        user_id: user.id, user_name: profile.name, user_role: profile.role,
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      total_tasks: tasks.length,
      processed_this_batch: batch.length,
      cursor_next: cursorNext,
      has_more: hasMore,
      batch_summary: { created, skipped, failed },
      results_this_batch: results,
    });
  } catch (e) {
    console.error('[nrs/backfill]', e);
    return NextResponse.json({ error: e.message || 'Backfill failed', success: false }, { status: 500 });
  }
}
