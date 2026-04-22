import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase-server';
import { parseNRSStatsToDailySales, applyRegister2AutoSync } from '@/lib/nrs-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Re-parse stored nrs_sync_log.nrs_response rows with the current parser and
// update the corresponding daily_sales rows. Used to backfill fields added to
// the parser (e.g. cashapp_check, R2 auto-sync) without re-hitting NRS.
//
// Optional body: { start_date, end_date, store_ids }. Owner-only.
export async function POST(req) {
  const userSupa = createClient();
  const { data: { user }, error: authErr } = await userSupa.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 });

  let body = {};
  try { body = await req.json(); } catch {}
  const { start_date, end_date, store_ids } = body || {};

  let logsQuery = admin
    .from('nrs_sync_log')
    .select('id, store_id, sync_date, nrs_response, created_daily_sales_id')
    .eq('status', 'success')
    .not('created_daily_sales_id', 'is', null)
    .not('nrs_response', 'is', null);
  if (start_date) logsQuery = logsQuery.gte('sync_date', start_date);
  if (end_date)   logsQuery = logsQuery.lte('sync_date', end_date);
  if (store_ids?.length) logsQuery = logsQuery.in('store_id', store_ids);

  const { data: logs, error: logsErr } = await logsQuery;
  if (logsErr) return NextResponse.json({ error: logsErr.message }, { status: 500 });

  const storeIdsFound = Array.from(new Set((logs || []).map(l => l.store_id)));
  const { data: storesData } = await admin
    .from('stores').select('id, has_register2').in('id', storeIdsFound);
  const storeMap = new Map((storesData || []).map(s => [s.id, s]));

  let updated = 0, skipped = 0, failed = 0;
  const errors = [];

  for (const log of logs || []) {
    try {
      const parsed = applyRegister2AutoSync(
        parseNRSStatsToDailySales(log.nrs_response, log.store_id, log.sync_date),
        !!storeMap.get(log.store_id)?.has_register2,
      );
      // Only overwrite NRS-derived fields — preserve user edits to R2 Safe Drop,
      // notes, receipts, house accounts, etc.
      const update = {
        r1_gross: parsed.r1_gross,
        r1_net: parsed.r1_net,
        gross_sales: parsed.gross_sales,
        net_sales: parsed.net_sales,
        non_tax_sales: parsed.non_tax_sales,
        cash_sales: parsed.cash_sales,
        card_sales: parsed.card_sales,
        cashapp_check: parsed.cashapp_check,
        r1_canceled_basket: parsed.r1_canceled_basket,
        r1_safe_drop: parsed.r1_safe_drop,
        r1_sales_tax: parsed.r1_sales_tax,
        tax_collected: parsed.tax_collected,
        r2_net: parsed.r2_net,
        r2_gross: parsed.r2_gross,
        register2_cash: parsed.register2_cash,
      };
      const { error: upErr } = await admin
        .from('daily_sales').update(update).eq('id', log.created_daily_sales_id);
      if (upErr) throw upErr;
      updated++;
    } catch (e) {
      failed++;
      errors.push({ log_id: log.id, date: log.sync_date, store_id: log.store_id, error: e.message });
    }
  }

  await admin.from('activity_log').insert({
    action: 'update',
    entity_type: 'nrs_reparse',
    description: `7S Agent re-parsed ${updated} synced rows (${failed} failed)${start_date ? ` from ${start_date}` : ''}${end_date ? ` to ${end_date}` : ''}`,
    user_id: user.id,
    user_role: 'owner',
  });

  return NextResponse.json({ considered: logs?.length || 0, updated, skipped, failed, errors: errors.slice(0, 20) });
}
