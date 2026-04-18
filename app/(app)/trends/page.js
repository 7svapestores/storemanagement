'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, TrendChart, Loading } from '@/components/UI';
import { V2StatCard } from '@/components/ui';
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

  if (!isOwner) return <div className="text-[var(--text-muted)] text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;
  const ob = trends.filter(w => w.diff < 0);
  const avg = trends.length ? trends.reduce((s,w) => s + (w.sales > 0 ? w.purchases/w.sales : 0), 0) / trends.length * 100 : 0;

  return (<div>
    <div className="mb-4">
      <p className="text-[var(--text-muted)] text-[11px] font-semibold uppercase tracking-wider">Analytics</p>
      <h1 className="text-[var(--text-primary)] text-[22px] font-bold tracking-tight">Purchase vs Sales Trends</h1>
    </div>
    <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />
    <div className="grid grid-cols-2 gap-3 mb-4">
      <V2StatCard label="Purchase Ratio" value={avg.toFixed(0)+'%'} icon="📊" variant={avg>80?'danger':avg>65?'warning':'success'} sub={avg>80?'Too high!':'Healthy'} />
      <V2StatCard label="Over-bought Weeks" value={`${ob.length}/${trends.length}`} icon="⚠️" variant={ob.length>2?'danger':'warning'} sub={`Loss: ${fK(ob.reduce((s,w)=>s+w.diff,0))}`} />
    </div>
    <div className="bg-[var(--bg-elevated)] rounded-xl p-4 border border-[var(--border-subtle)] mb-3.5"><TrendChart data={trends} height={220} /></div>
    <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
      <DataTable columns={[
        { key: 'label', label: 'Week' },
        { key: 'purchases', label: 'Buy', align: 'right', mono: true, render: v => <span className="text-[var(--color-warning)]">{fmt(v)}</span> },
        { key: 'sales', label: 'Sell', align: 'right', mono: true, render: v => <span className="text-[var(--color-success)]">{fmt(v)}</span> },
        { key: 'diff', label: 'Net', align: 'right', mono: true, render: v => <span className={v>=0?'text-[var(--color-success)] font-bold':'text-[var(--color-danger)] font-bold'}>{v>=0?'+':''}{fmt(v)}</span> },
        { key: '_s', label: '', align: 'center', render: (_,r) => r.diff < 0 ? <span className="bg-sw-redD text-[var(--color-danger)] text-[9px] font-bold px-1.5 py-0.5 rounded">OVER</span> : <span className="bg-sw-greenD text-[var(--color-success)] text-[9px] font-bold px-1.5 py-0.5 rounded">OK</span> },
      ]} rows={[...trends].reverse()} isOwner={false} />
    </div>
  </div>);
}
