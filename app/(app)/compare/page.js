'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DateBar, useDateRange, PageHeader, Loading, Alert } from '@/components/UI';
import { fmt, fK } from '@/lib/utils';

export default function ComparePage() {
  const { supabase, isOwner } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('thismonth');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const { data: stores } = await supabase.from('stores').select('*').eq('is_active', true);
        const [{ data: sales }, { data: purch }, { data: exps }] = await Promise.all([
          supabase.from('daily_sales').select('store_id, total_sales, tax_collected').gte('date', range.start).lte('date', range.end),
          supabase.from('purchases').select('store_id, total_cost').gte('week_of', range.start).lte('week_of', range.end),
          supabase.from('expenses').select('store_id, amount').gte('month', range.start.slice(0, 7)).lte('month', range.end.slice(0, 7)),
        ]);

        const out = (stores || []).map(st => {
          const rev = (sales || []).filter(r => r.store_id === st.id).reduce((s, r) => s + (r.total_sales || 0), 0);
          const tax = (sales || []).filter(r => r.store_id === st.id).reduce((s, r) => s + (r.tax_collected || 0), 0);
          const pur = (purch || []).filter(r => r.store_id === st.id).reduce((s, r) => s + (r.total_cost || 0), 0);
          const exp = (exps || []).filter(r => r.store_id === st.id).reduce((s, r) => s + (r.amount || 0), 0);
          const net = rev - pur - exp;
          const margin = rev > 0 ? (net / rev) * 100 : 0;
          return { ...st, revenue: rev, purchases: pur, expenses: exp, net, margin, tax };
        }).sort((a, b) => b.net - a.net);

        setRows(out);
      } catch (e) {
        console.error('[compare] load failed:', e);
        setLoadError(e?.message || 'Failed to load comparison');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [range.start, range.end]);

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  const maxRev = Math.max(1, ...rows.map(r => r.revenue));
  const maxExp = Math.max(1, ...rows.map(r => r.expenses));
  const maxNet = Math.max(1, ...rows.map(r => Math.abs(r.net)));
  const best = rows.length ? rows[0] : null;
  const worst = rows.length ? rows[rows.length - 1] : null;

  const Bar = ({ value, max, color, negative }) => (
    <div className="bg-sw-card2 rounded h-3 overflow-hidden relative">
      <div className="h-full absolute left-0 top-0" style={{ width: `${(Math.abs(value) / max) * 100}%`, background: negative ? '#F87171aa' : color }} />
    </div>
  );

  return (
    <div>
      <PageHeader title="📊 Compare Stores" subtitle={`${range.start} to ${range.end}`} />

      {loadError && <Alert type="error">{loadError}</Alert>}

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      {rows.length === 0 ? (
        <div className="bg-sw-card border border-sw-border rounded-xl p-8 text-center text-sw-dim">
          No store data for this period.
        </div>
      ) : (
        <>
          {best && worst && best.id !== worst.id && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <div className="bg-sw-greenD border border-sw-green/30 rounded-xl p-4">
                <div className="text-sw-green text-[10px] font-bold uppercase tracking-wide mb-1">🏆 Best Performer</div>
                <div className="text-sw-text text-base font-extrabold">{best.name}</div>
                <div className="text-sw-sub text-[11px] mt-1">Net profit: <span className="text-sw-green font-mono font-bold">{fmt(best.net)}</span> · Margin: {best.margin.toFixed(1)}%</div>
              </div>
              <div className="bg-sw-redD border border-sw-red/30 rounded-xl p-4">
                <div className="text-sw-red text-[10px] font-bold uppercase tracking-wide mb-1">⚠️ Needs Attention</div>
                <div className="text-sw-text text-base font-extrabold">{worst.name}</div>
                <div className="text-sw-sub text-[11px] mt-1">Net profit: <span className="text-sw-red font-mono font-bold">{fmt(worst.net)}</span> · Margin: {worst.margin.toFixed(1)}%</div>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {/* Revenue */}
            <div className="bg-sw-card border border-sw-border rounded-xl p-4">
              <h3 className="text-sw-text text-xs font-bold mb-3">Revenue</h3>
              <div className="space-y-2">
                {rows.map(r => (
                  <div key={r.id} className="flex items-center gap-2">
                    <div className="w-40 flex items-center gap-1.5 flex-shrink-0">
                      <span className="w-2 h-2 rounded-sm" style={{ background: r.color }} />
                      <span className="text-sw-text text-[11px] font-semibold truncate">{r.name}</span>
                    </div>
                    <div className="flex-1"><Bar value={r.revenue} max={maxRev} color="#34D399" /></div>
                    <span className="w-20 text-right text-sw-green font-mono text-[11px] font-bold">{fK(r.revenue)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Expenses */}
            <div className="bg-sw-card border border-sw-border rounded-xl p-4">
              <h3 className="text-sw-text text-xs font-bold mb-3">Expenses</h3>
              <div className="space-y-2">
                {rows.map(r => (
                  <div key={r.id} className="flex items-center gap-2">
                    <div className="w-40 flex items-center gap-1.5 flex-shrink-0">
                      <span className="w-2 h-2 rounded-sm" style={{ background: r.color }} />
                      <span className="text-sw-text text-[11px] font-semibold truncate">{r.name}</span>
                    </div>
                    <div className="flex-1"><Bar value={r.expenses} max={maxExp} color="#FBBF2488" /></div>
                    <span className="w-20 text-right text-sw-amber font-mono text-[11px]">{fK(r.expenses)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Net profit */}
            <div className="bg-sw-card border border-sw-border rounded-xl p-4">
              <h3 className="text-sw-text text-xs font-bold mb-3">Net Profit</h3>
              <div className="space-y-2">
                {rows.map(r => (
                  <div key={r.id} className="flex items-center gap-2">
                    <div className="w-40 flex items-center gap-1.5 flex-shrink-0">
                      <span className="w-2 h-2 rounded-sm" style={{ background: r.color }} />
                      <span className="text-sw-text text-[11px] font-semibold truncate">{r.name}</span>
                    </div>
                    <div className="flex-1"><Bar value={r.net} max={maxNet} color="#39FF14aa" negative={r.net < 0} /></div>
                    <span className={`w-20 text-right font-mono text-[11px] font-bold ${r.net >= 0 ? 'text-sw-green' : 'text-sw-red'}`}>
                      {r.net >= 0 ? '' : '-'}{fK(Math.abs(r.net))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
