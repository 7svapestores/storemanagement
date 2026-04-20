import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase-server';
import { sendTelegram, buildInventoryPlanningMessage } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

function centralToday() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function GET() {
  try {
    const userSupa = createClient();
    const { data: { user } } = await userSupa.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Log in first' }, { status: 401 });

    const supabase = createAdminClient();
    const today = centralToday();
    const d = new Date(today + 'T12:00:00');
    const weekAgo = new Date(d); weekAgo.setDate(weekAgo.getDate() - 7);
    const weekStart = weekAgo.toISOString().split('T')[0];
    const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

    const { data: stores } = await supabase.from('stores').select('id, name').order('created_at');
    const { data: weekSales } = await supabase.from('daily_sales').select('store_id, net_sales').gte('date', weekStart).lte('date', today);
    const { data: mtdSales } = await supabase.from('daily_sales').select('store_id, net_sales').gte('date', monthStart).lte('date', today);
    const { data: weekPurch } = await supabase.from('purchases').select('store_id, total_cost, unit_cost').gte('week_of', weekStart).lte('week_of', today);
    const { data: mtdPurch } = await supabase.from('purchases').select('store_id, total_cost, unit_cost').gte('week_of', monthStart).lte('week_of', today);

    const sum = (rows, storeId, field) =>
      (rows || []).filter(r => r.store_id === storeId).reduce((s, r) => s + Number(field === 'purch' ? (r.total_cost || r.unit_cost || 0) : (r[field] || 0)), 0);

    const storesData = (stores || []).map(st => {
      const ws = sum(weekSales, st.id, 'net_sales');
      const wb = sum(weekPurch, st.id, 'purch');
      const ms = sum(mtdSales, st.id, 'net_sales');
      const mb = sum(mtdPurch, st.id, 'purch');
      return { name: st.name, weekly_sales: ws, weekly_bought: wb, weekly_ratio: wb > 0 ? ws / wb : 0, mtd_sales: ms, mtd_bought: mb, mtd_ratio: mb > 0 ? ms / mb : 0 };
    });

    const totals = {
      week_sales: storesData.reduce((s, st) => s + st.weekly_sales, 0),
      week_bought: storesData.reduce((s, st) => s + st.weekly_bought, 0),
      mtd_sales: storesData.reduce((s, st) => s + st.mtd_sales, 0),
      mtd_bought: storesData.reduce((s, st) => s + st.mtd_bought, 0),
    };

    const message = buildInventoryPlanningMessage({ stores: storesData, totals });
    const result = await sendTelegram(message);

    return NextResponse.json({ success: result.sent, date: today, week_start: weekStart, month_start: monthStart, stores: storesData, totals, telegram: result });
  } catch (e) {
    console.error('[weekly-inventory-test]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
