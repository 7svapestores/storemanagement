'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, TrendChart, PageHeader, StatCard, Loading } from '@/components/UI';
import { fmt, fK, weekLabel } from '@/lib/utils';

export default function TrendsPage() {
  const { supabase, isOwner, effectiveStoreId } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('last90');
  const [trends, setTrends] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => {
    setLoading(true);
    let salesQ = supabase.from('daily_sales').select('date, total_sales, store_id').gte('date', range.start).lte('date', range.end);
    let purchQ = supabase.from('purchases').select('week_of, total_cost, store_id').gte('week_of', range.start).lte('week_of', range.end);
    if (effectiveStoreId) { salesQ = salesQ.eq('store_id', effectiveStoreId); purchQ = purchQ.eq('store_id', effectiveStoreId); }
    const { data: sales } = await salesQ;
    const { data: purch } = await purchQ;
    const map = {};
    sales?.forEach(s => { const d = new Date(s.date); const dy = d.getDay(); d.setDate(d.getDate()-dy+(dy===0?-6:1)); const w = d.toISOString().split('T')[0]; map[w] = {...(map[w]||{sales:0,purchases:0}), sales: (map[w]?.sales||0)+(s.total_sales||0)}; });
    purch?.forEach(p => { const w = (typeof p.week_of === 'string' ? p.week_of : new Date(p.week_of).toISOString()).split('T')[0]; map[w] = {...(map[w]||{sales:0,purchases:0}), purchases: (map[w]?.purchases||0)+(p.total_cost||0)}; });
    setTrends(Object.entries(map).map(([w,d]) => ({week:w,...d,diff:d.sales-d.purchases,label:weekLabel(w)})).sort((a,b) => a.week.localeCompare(b.week)));
    setLoading(false);
  })(); }, [range.start, range.end, effectiveStoreId]);

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;
  const ob = trends.filter(w => w.diff < 0);
  const avg = trends.length ? trends.reduce((s,w) => s + (w.sales > 0 ? w.purchases/w.sales : 0), 0) / trends.length * 100 : 0;

  return (<div>
    <PageHeader title="📈 Purchase vs Sales Trends" />
    <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />
    <div className="flex gap-2.5 flex-wrap mb-3.5">
      <StatCard label="Purchase Ratio" value={avg.toFixed(0)+'%'} icon="📊" color={avg>80?'#F87171':avg>65?'#FBBF24':'#34D399'} sub={avg>80?'Too high!':'Healthy'} />
      <StatCard label="Over-bought Weeks" value={`${ob.length}/${trends.length}`} icon="⚠️" color={ob.length>2?'#F87171':'#FBBF24'} sub={`Loss: ${fK(ob.reduce((s,w)=>s+w.diff,0))}`} />
    </div>
    <div className="bg-sw-card rounded-xl p-4 border border-sw-border mb-3.5"><TrendChart data={trends} height={220} /></div>
    <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
      <DataTable columns={[
        { key: 'label', label: 'Week' },
        { key: 'purchases', label: 'Buy', align: 'right', mono: true, render: v => <span className="text-sw-amber">{fmt(v)}</span> },
        { key: 'sales', label: 'Sell', align: 'right', mono: true, render: v => <span className="text-sw-green">{fmt(v)}</span> },
        { key: 'diff', label: 'Net', align: 'right', mono: true, render: v => <span className={v>=0?'text-sw-green font-bold':'text-sw-red font-bold'}>{v>=0?'+':''}{fmt(v)}</span> },
        { key: '_s', label: '', align: 'center', render: (_,r) => r.diff < 0 ? <span className="bg-sw-redD text-sw-red text-[9px] font-bold px-1.5 py-0.5 rounded">OVER</span> : <span className="bg-sw-greenD text-sw-green text-[9px] font-bold px-1.5 py-0.5 rounded">OK</span> },
      ]} rows={[...trends].reverse()} isOwner={false} />
    </div>
  </div>);
}
