'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { StatCard, DateBar, useDateRange, TrendChart, PageHeader, Alert, Loading, StoreBadge } from '@/components/UI';
import { fK, fmt, weekLabel } from '@/lib/utils';

export default function DashboardPage() {
  const { supabase, isOwner, profile } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('last30');
  const [stats, setStats] = useState(null);
  const [trends, setTrends] = useState([]);
  const [stores, setStores] = useState([]);
  const [lowStock, setLowStock] = useState(0);
  const [loading, setLoading] = useState(true);

  const storeId = isOwner ? null : profile?.store_id;

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      // Get stores
      const { data: storeData } = await supabase.from('stores').select('*').order('created_at');
      setStores(storeData || []);

      // Sales
      let salesQ = supabase.from('daily_sales').select('cash_sales, card_sales, total_sales, credits, tax_collected, date, store_id')
        .gte('date', range.start).lte('date', range.end);
      if (storeId) salesQ = salesQ.eq('store_id', storeId);
      const { data: sales } = await salesQ;

      // Purchases
      let purchQ = supabase.from('purchases').select('total_cost, week_of, store_id')
        .gte('week_of', range.start).lte('week_of', range.end);
      if (storeId) purchQ = purchQ.eq('store_id', storeId);
      const { data: purch } = await purchQ;

      // Expenses
      let expQ = supabase.from('expenses').select('amount');
      if (storeId) expQ = expQ.eq('store_id', storeId);
      const { data: exps } = await expQ;

      // Low stock
      let invQ = supabase.from('inventory').select('stock, reorder_level').eq('is_active', true);
      if (storeId) invQ = invQ.eq('store_id', storeId);
      const { data: inv } = await invQ;
      setLowStock(inv?.filter(i => i.stock <= i.reorder_level).length || 0);

      // Compute stats
      const totalSales = sales?.reduce((s, r) => s + (r.total_sales || 0), 0) || 0;
      const totalCash = sales?.reduce((s, r) => s + (r.cash_sales || 0), 0) || 0;
      const totalCard = sales?.reduce((s, r) => s + (r.card_sales || 0), 0) || 0;
      const totalTax = sales?.reduce((s, r) => s + (r.tax_collected || 0), 0) || 0;
      const totalPurch = purch?.reduce((s, r) => s + (r.total_cost || 0), 0) || 0;
      const totalExp = exps?.reduce((s, r) => s + (r.amount || 0), 0) || 0;

      setStats({ totalSales, totalCash, totalCard, totalTax, totalPurch, totalExp, net: totalSales - totalPurch - totalExp });

      // Weekly trends
      const weekMap = {};
      sales?.forEach(s => {
        const d = new Date(s.date); const day = d.getDay();
        d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
        const wk = d.toISOString().split('T')[0];
        weekMap[wk] = { ...(weekMap[wk] || { sales: 0, purchases: 0 }), sales: (weekMap[wk]?.sales || 0) + (s.total_sales || 0) };
      });
      purch?.forEach(p => {
        const wk = typeof p.week_of === 'string' ? p.week_of.split('T')[0] : new Date(p.week_of).toISOString().split('T')[0];
        weekMap[wk] = { ...(weekMap[wk] || { sales: 0, purchases: 0 }), purchases: (weekMap[wk]?.purchases || 0) + (p.total_cost || 0) };
      });
      const trendData = Object.entries(weekMap)
        .map(([week, d]) => ({ week, ...d, diff: d.sales - d.purchases, label: weekLabel(week) }))
        .sort((a, b) => a.week.localeCompare(b.week));
      setTrends(trendData);

      setLoading(false);
    };
    load();
  }, [range.start, range.end, storeId]);

  if (loading) return <Loading />;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={storeId ? stores.find(s => s.id === storeId)?.name : 'All Stores'} />
      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      {lowStock > 0 && <Alert type="warning"><b>{lowStock}</b> items below reorder level</Alert>}

      {stats && (
        <div className="flex gap-2.5 flex-wrap mb-3.5">
          <StatCard label="Total Sales" value={fK(stats.totalSales)} icon="💰" color="#34D399" sub={`Cash ${fK(stats.totalCash)} · Card ${fK(stats.totalCard)}`} />
          <StatCard label="Purchases" value={fK(stats.totalPurch)} icon="🛒" color={stats.totalPurch > stats.totalSales ? '#F87171' : '#FBBF24'} />
          <StatCard label="Net Profit" value={fK(stats.net)} icon={stats.net >= 0 ? '✅' : '⚠️'} color={stats.net >= 0 ? '#34D399' : '#F87171'} />
          <StatCard label="Tax Collected" value={fK(stats.totalTax)} icon="🏛️" color="#22D3EE" />
        </div>
      )}

      <div className="bg-sw-card rounded-xl p-4 border border-sw-border mb-3.5">
        <h3 className="text-sw-text text-[13px] font-bold mb-3">Purchases vs Sales — Weekly</h3>
        <TrendChart data={trends} />
      </div>

      {isOwner && !storeId && stores.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5">
          {stores.map(st => (
            <div key={st.id} className="bg-sw-card rounded-lg p-3 border border-sw-border hover:border-sw-border/80 cursor-pointer transition-colors">
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className="w-2 h-2 rounded-sm" style={{ background: st.color }} />
                <span className="text-sw-text text-xs font-bold">{st.name}</span>
              </div>
              <div className="text-sw-sub text-[11px]">{st.email || '—'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
