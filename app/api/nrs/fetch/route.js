import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase-server';
import { fetchNRSDailyStats, parseNRSStatsToDailySales, applyRegister2AutoSync } from '@/lib/nrs-client';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const userSupa = createClient();
    const { data: { user }, error: authErr } = await userSupa.auth.getUser();
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { store_id, date, debug } = await req.json();
    if (!store_id || !date) return NextResponse.json({ error: 'store_id and date are required' }, { status: 400 });

    const admin = createAdminClient();
    const { data: store } = await admin.from('stores').select('id, name, nrs_store_id, has_register2').eq('id', store_id).single();
    if (!store?.nrs_store_id) return NextResponse.json({ error: 'Store has no NRS ID configured' }, { status: 400 });

    console.log('[nrs/fetch] fetching store', store.name, 'nrs_id', store.nrs_store_id, 'date', date);
    const nrsData = await fetchNRSDailyStats(store.nrs_store_id, date);
    console.log('[nrs/fetch] nrsData keys:', Object.keys(nrsData));

    const parsed = applyRegister2AutoSync(
      parseNRSStatsToDailySales(nrsData, store_id, date),
      store.has_register2,
    );
    console.log('[nrs/fetch] parsed preview: gross=', parsed.r1_gross, 'net=', parsed.r1_net, 'cash=', parsed.cash_sales, 'card=', parsed.card_sales);

    const { data: existing } = await admin.from('daily_sales').select('id').eq('store_id', store_id).eq('date', date).maybeSingle();

    const response = {
      success: true,
      preview: parsed,
      existing_sale_id: existing?.id || null,
      store_name: store.name,
    };

    if (debug) {
      response.rawNRS = nrsData;
    }

    return NextResponse.json(response);
  } catch (e) {
    console.error('[nrs/fetch]', e);
    return NextResponse.json({ error: e.message || 'NRS fetch failed' }, { status: 500 });
  }
}
