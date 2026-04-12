'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, PageHeader, StatCard, Loading, StoreBadge } from '@/components/UI';
import { fmt, fK } from '@/lib/utils';

export default function ReportsPage() {
  const { supabase, isOwner } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('last30');
  const [report, setReport] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => {
    setLoading(true);
    const { data: stores } = await supabase.from('stores').select('*').eq('is_active', true);
    const rows = await Promise.all((stores||[]).map(async st => {
      const [{ data: s }, { data: p }, { data: e }] = await Promise.all([
        supabase.from('daily_sales').select('total_sales, tax_collected').eq('store_id', st.id).gte('date', range.start).lte('date', range.end),
        supabase.from('purchases').select('total_cost').eq('store_id', st.id).gte('week_of', range.start).lte('week_of', range.end),
        supabase.from('expenses').select('amount').eq('store_id', st.id),
      ]);
      const sales = s?.reduce((a,r) => a+(r.total_sales||0), 0)||0;
      const tax = s?.reduce((a,r) => a+(r.tax_collected||0), 0)||0;
      const purch = p?.reduce((a,r) => a+(r.total_cost||0), 0)||0;
      const exp = e?.reduce((a,r) => a+(r.amount||0), 0)||0;
      return { ...st, sales, purchases: purch, expenses: exp, tax, profit: sales-purch-exp, margin: sales > 0 ? ((sales-purch-exp)/sales*100) : 0 };
    }));
    setReport(rows.sort((a,b) => b.profit-a.profit));
    setLoading(false);
  })(); }, [range.start, range.end]);

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;
  const tot = report.reduce((a,s) => ({sales:a.sales+s.sales, purch:a.purch+s.purchases, exp:a.exp+s.expenses, profit:a.profit+s.profit, tax:a.tax+s.tax}), {sales:0,purch:0,exp:0,profit:0,tax:0});

  return (<div>
    <PageHeader title="📑 P&L Report" />
    <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />
    <div className="flex gap-2.5 flex-wrap mb-3.5">
      <StatCard label="Revenue" value={fK(tot.sales)} icon="💰" color="#34D399" />
      <StatCard label="Costs" value={fK(tot.purch+tot.exp)} icon="📉" color="#F87171" />
      <StatCard label="Net Profit" value={fK(tot.profit)} icon={tot.profit>=0?'🟢':'🔴'} color={tot.profit>=0?'#34D399':'#F87171'} />
      <StatCard label="Tax" value={fK(tot.tax)} icon="🏛️" color="#22D3EE" />
    </div>
    <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
      <DataTable columns={[
        { key: 'name', label: 'Store', render: (v,r) => <StoreBadge name={v} color={r.color} /> },
        { key: 'sales', label: 'Revenue', align: 'right', mono: true, render: v => <span className="text-sw-green">{fmt(v)}</span> },
        { key: 'purchases', label: 'Purchases', align: 'right', mono: true, render: v => fmt(v) },
        { key: 'expenses', label: 'Expenses', align: 'right', mono: true, render: v => fmt(v) },
        { key: 'tax', label: 'Tax', align: 'right', mono: true, render: v => <span className="text-sw-cyan">{fmt(v)}</span> },
        { key: 'profit', label: 'Profit', align: 'right', mono: true, render: v => <span className={v>=0?'text-sw-green font-bold':'text-sw-red font-bold'}>{fmt(v)}</span> },
        { key: 'margin', label: 'Margin', align: 'right', mono: true, render: v => <span className={v>=20?'text-sw-green':v>=0?'text-sw-amber':'text-sw-red'}>{v.toFixed(1)}%</span> },
      ]} rows={report} isOwner={false} />
    </div>
  </div>);
}
