import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase-server';
import { fetchNRSDailyStats, parseNRSStatsToDailySales } from '@/lib/nrs-client';

export async function POST(req) {
  try {
    const userSupa = createClient();
    const { data: { user }, error: authErr } = await userSupa.auth.getUser();
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { store_id, date } = await req.json();
    if (!store_id || !date) return NextResponse.json({ error: 'store_id and date are required' }, { status: 400 });

    const admin = createAdminClient();
    const { data: store } = await admin.from('stores').select('id, name, nrs_store_id').eq('id', store_id).single();
    if (!store?.nrs_store_id) return NextResponse.json({ error: 'Store has no NRS ID configured' }, { status: 400 });

    const nrsData = await fetchNRSDailyStats(store.nrs_store_id, date);
    const parsed = parseNRSStatsToDailySales(nrsData, store_id, date);

    const { data: existing } = await admin.from('daily_sales').select('id').eq('store_id', store_id).eq('date', date).maybeSingle();

    return NextResponse.json({
      preview: parsed,
      raw: nrsData,
      existing_sale_id: existing?.id || null,
      store_name: store.name,
    });
  } catch (e) {
    console.error('[nrs/fetch]', e);
    return NextResponse.json({ error: e.message || 'NRS fetch failed' }, { status: 500 });
  }
}
