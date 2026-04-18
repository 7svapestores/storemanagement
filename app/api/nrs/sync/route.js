import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase-server';
import { fetchNRSDailyStats, parseNRSStatsToDailySales } from '@/lib/nrs-client';

export async function POST(req) {
  try {
    const userSupa = createClient();
    const { data: { user }, error: authErr } = await userSupa.auth.getUser();
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { store_id, date, force_overwrite } = await req.json();
    if (!store_id || !date) return NextResponse.json({ error: 'store_id and date are required' }, { status: 400 });

    const admin = createAdminClient();

    const { data: profile } = await admin.from('profiles').select('id, name, role').eq('id', user.id).single();
    const { data: store } = await admin.from('stores').select('id, name, nrs_store_id').eq('id', store_id).single();
    if (!store?.nrs_store_id) return NextResponse.json({ error: 'Store has no NRS ID configured' }, { status: 400 });

    const { data: existing } = await admin.from('daily_sales').select('id').eq('store_id', store_id).eq('date', date).maybeSingle();
    if (existing && !force_overwrite) {
      return NextResponse.json({ error: 'Entry already exists for this date', existing_id: existing.id }, { status: 409 });
    }

    const nrsData = await fetchNRSDailyStats(store.nrs_store_id, date);
    const parsed = parseNRSStatsToDailySales(nrsData, store_id, date);
    parsed.entered_by = user.id;

    let result;
    if (existing && force_overwrite) {
      const { data, error } = await admin.from('daily_sales').update(parsed).eq('id', existing.id).select().single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await admin.from('daily_sales').insert(parsed).select().single();
      if (error) throw error;
      result = data;
    }

    // Sync cash collection expected amount
    const expectedCash = (parsed.r1_safe_drop || 0) + (parsed.r2_safe_drop || 0);
    await admin.from('cash_collections').upsert(
      { store_id, date, expected_amount: expectedCash },
      { onConflict: 'store_id,date', ignoreDuplicates: false }
    );

    // Log sync
    await admin.from('nrs_sync_log').insert({
      store_id,
      sync_date: date,
      status: 'success',
      nrs_response: nrsData,
      created_daily_sales_id: result.id,
      synced_by: user.id,
    });

    // Activity log
    await admin.from('activity_log').insert({
      action: existing ? 'update' : 'create',
      entity_type: 'daily_sales',
      entity_id: result.id,
      description: `7S Agent synced daily sales for ${store.name} on ${date} ($${parsed.r1_net} net) — triggered by ${profile?.name || 'Owner'}`,
      user_id: user.id,
      user_name: profile?.name,
      user_role: profile?.role,
      store_name: store.name,
    });

    return NextResponse.json({ sale: result, synced: true });
  } catch (e) {
    console.error('[nrs/sync]', e);
    return NextResponse.json({ error: e.message || 'Sync failed' }, { status: 500 });
  }
}
