import { createClient, createAdminClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { fetchNRSDailyStats, parseNRSStatsToDailySales, applyRegister2AutoSync } from '@/lib/nrs-client';

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

export async function GET(request) {
  try {
    const userSupa = createClient();
    const { data: { user }, error: authErr } = await userSupa.auth.getUser();
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminClient();
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 });

    const url = new URL(request.url);
    const targetDate = url.searchParams.get('date') || yesterdayCentral();

    const { data: stores } = await admin
      .from('stores')
      .select('id, name, nrs_store_id, has_register2')
      .not('nrs_store_id', 'is', null)
      .order('created_at');

    const results = [];
    for (const store of (stores || [])) {
      try {
        const { data: existing } = await admin.from('daily_sales').select('id').eq('store_id', store.id).eq('date', targetDate).maybeSingle();
        if (existing) {
          results.push({ store: store.name, status: 'skipped', message: 'Already exists', existing_id: existing.id });
          continue;
        }

        const nrsData = await fetchNRSDailyStats(store.nrs_store_id, targetDate);
        const parsed = applyRegister2AutoSync(
          parseNRSStatsToDailySales(nrsData, store.id, targetDate),
          store.has_register2,
        );
        parsed.entered_by = user.id;

        const { data: inserted, error } = await admin.from('daily_sales').insert(parsed).select().single();
        if (error) throw error;

        await admin.from('nrs_sync_log').insert({
          store_id: store.id, sync_date: targetDate, status: 'success',
          nrs_response: nrsData, created_daily_sales_id: inserted.id, synced_by: user.id,
        });

        results.push({
          store: store.name, status: 'created',
          gross: parsed.r1_gross, net: parsed.r1_net,
          cash: parsed.cash_sales, card: parsed.card_sales,
          tax: parsed.tax_collected, safe_drop: parsed.r1_safe_drop,
        });
      } catch (e) {
        results.push({ store: store.name, status: 'failed', error: e.message });
        await admin.from('nrs_sync_log').insert({
          store_id: store.id, sync_date: targetDate, status: 'failed',
          error_message: e.message, synced_by: user.id,
        }).catch(() => {});
      }
      await new Promise(r => setTimeout(r, 500));
    }

    return NextResponse.json({ date: targetDate, results });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
