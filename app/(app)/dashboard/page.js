'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { StatCard, DateBar, useDateRange, TrendChart, PageHeader, Alert, Loading, StoreBadge } from '@/components/UI';
import { fK, fmt, weekLabel, today } from '@/lib/utils';

export default function DashboardPage() {
  const { supabase, isOwner, profile, effectiveStoreId } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('last30');
  const [stats, setStats] = useState(null);
  const [trends, setTrends] = useState([]);
  const [stores, setStores] = useState([]);
  const [lowStock, setLowStock] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [todaySales, setTodaySales] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [nrsStatus, setNrsStatus] = useState(null);

  // Dashboard honors the sidebar store selector. Employees are always scoped
  // to their own store via effectiveStoreId in AuthProvider.
  const storeId = effectiveStoreId;

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError('');
      try {

      // Get stores
      const { data: storeData } = await supabase.from('stores').select('*').order('created_at');
      setStores(storeData || []);

      // Check NRS connection (non-blocking)
      fetch('/api/nrs/validate').then(r => r.json()).then(d => setNrsStatus(d?.valid)).catch(() => setNrsStatus(false));

      // Sales — pull all the numeric columns we need for dashboard totals.
      let salesQ = supabase.from('daily_sales')
        .select('cash_sales, card_sales, register2_cash, register2_card, total_sales, gross_sales, net_sales, short_over, credits, tax_collected, date, store_id')
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
      const totalGross = sales?.reduce((s, r) => s + (r.gross_sales ?? r.total_sales ?? 0), 0) || 0;
      const totalCash = sales?.reduce((s, r) => s + (r.cash_sales || 0) + (r.register2_cash || 0), 0) || 0;
      const totalCard = sales?.reduce((s, r) => s + (r.card_sales || 0) + (r.register2_card || 0), 0) || 0;
      const totalCredits = sales?.reduce((s, r) => s + (r.credits || 0), 0) || 0;
      const totalNet = sales?.reduce((s, r) => s + (r.net_sales ?? ((r.gross_sales ?? r.total_sales ?? 0) - (r.credits || 0))), 0) || 0;
      const totalShortOver = sales?.reduce((s, r) => s + (r.short_over || 0), 0) || 0;
      const totalTax = sales?.reduce((s, r) => s + (r.tax_collected || 0), 0) || 0;
      const totalPurch = purch?.reduce((s, r) => s + (r.total_cost || 0), 0) || 0;
      const totalExp = exps?.reduce((s, r) => s + (r.amount || 0), 0) || 0;

      setStats({
        totalGross, totalNet, totalCash, totalCard, totalCredits, totalShortOver,
        totalTax, totalPurch, totalExp,
        netProfit: totalNet - totalPurch - totalExp,
      });

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

      // Today's snapshot — per-store sales for today
      const todayStr = today();
      let todayQ = supabase.from('daily_sales').select('store_id, cash_sales, card_sales, register2_cash, register2_card, gross_sales, total_sales').eq('date', todayStr);
      if (storeId) todayQ = todayQ.eq('store_id', storeId);
      const { data: todayRows } = await todayQ;
      setTodaySales(todayRows || []);

      // Recent activity (owner only — employee has no permission to view)
      if (isOwner) {
        const { data: acts } = await supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(10);
        setRecentActivity(acts || []);
      } else {
        setRecentActivity([]);
      }
      } catch (e) {
        console.error('[dashboard] load failed:', e);
        setLoadError(e?.message || 'Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [range.start, range.end, storeId]);

  if (loading) return <Loading />;

  return (
    <div>
      <PageHeader
        title={storeId ? `Dashboard — ${stores.find(s => s.id === storeId)?.name || 'Store'}` : 'Dashboard — All Stores'}
      />
      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      {loadError && <Alert type="error">{loadError}</Alert>}
      {isOwner && nrsStatus !== null && (
        <div className={`mb-3 rounded-lg px-3 py-2 text-[11px] font-semibold flex items-center gap-2 ${nrsStatus ? 'bg-sw-greenD text-sw-green border border-sw-green/30' : 'bg-sw-redD text-sw-red border border-sw-red/30'}`}>
          {nrsStatus ? '✓ NRS Connected' : '✕ NRS Token Invalid — update NRS_USER_TOKEN in Vercel env vars'}
        </div>
      )}
      {lowStock > 0 && <Alert type="warning"><b>{lowStock}</b> items below reorder level</Alert>}

      {/* Today's snapshot — per-store */}
      {stores.length > 0 && (
        <div className="bg-sw-card border border-sw-border rounded-xl p-4 mb-3.5">
          <h3 className="text-sw-text text-[13px] font-bold mb-3">Today's Snapshot</h3>
          {(() => {
            const totalToday = todaySales.reduce((s, r) => s + (r.gross_sales ?? r.total_sales ?? 0), 0);
            const perStore = stores.map(st => {
              const rec = todaySales.find(r => r.store_id === st.id);
              return { ...st, rec };
            });
            const missing = perStore.filter(s => !s.rec);
            return (
              <>
                <div className="flex items-end justify-between mb-3">
                  <div>
                    <div className="text-sw-sub text-[10px] font-bold uppercase">Total today</div>
                    <div className="text-sw-green text-2xl font-extrabold font-mono">{fmt(totalToday)}</div>
                  </div>
                  {missing.length > 0 && (
                    <div className="text-sw-amber text-[11px] font-semibold bg-sw-amberD px-2 py-1 rounded">
                      ⚠️ {missing.length} store{missing.length > 1 ? 's' : ''} missing today's entry
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {perStore.map(s => (
                    <div key={s.id} className={`rounded-lg p-2.5 border ${s.rec ? 'bg-sw-card2 border-sw-border' : 'bg-sw-amberD border-sw-amber/30'}`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />
                        <span className="text-sw-text text-[11px] font-bold truncate">{s.name}</span>
                      </div>
                      {s.rec ? (
                        <div className="flex items-baseline justify-between">
                          <span className="text-sw-green font-mono font-bold">{fmt(s.rec.gross_sales ?? s.rec.total_sales)}</span>
                          <span className="text-sw-sub text-[10px]">{fK((s.rec.cash_sales || 0) + (s.rec.register2_cash || 0))} cash · {fK((s.rec.card_sales || 0) + (s.rec.register2_card || 0))} card</span>
                        </div>
                      ) : (
                        <div className="text-sw-amber text-[11px] font-semibold">Not entered yet</div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3.5">
          <StatCard label="Gross Sales" value={fK(stats.totalGross)} icon="💰" color="#34D399" sub={`Cash ${fK(stats.totalCash)} · Card ${fK(stats.totalCard)}`} />
          <StatCard label="Net Sales" value={fK(stats.totalNet)} icon="📈" color="#39FF14" sub={`Credits ${fK(stats.totalCredits)}`} />
          <StatCard label="Expenses" value={fK(stats.totalExp)} icon="📋" color="#F87171" />
          <StatCard
            label="Short / Over"
            value={`${stats.totalShortOver >= 0 ? '+' : ''}${fK(stats.totalShortOver)}`}
            icon={stats.totalShortOver === 0 ? '➖' : stats.totalShortOver < 0 ? '🔴' : '🟢'}
            color={stats.totalShortOver === 0 ? '#64748B' : stats.totalShortOver < 0 ? '#F87171' : '#34D399'}
          />
        </div>
      )}

      <div className="bg-sw-card rounded-xl p-4 border border-sw-border mb-3.5 max-w-full overflow-hidden">
        <h3 className="text-sw-text text-[13px] font-bold mb-3">Purchases vs Sales — Weekly</h3>
        <div className="max-w-full overflow-x-auto">
          <TrendChart data={trends} />
        </div>
      </div>

      {/* Recent activity feed (owner only) */}
      {isOwner && recentActivity.length > 0 && (
        <div className="bg-sw-card rounded-xl p-4 border border-sw-border mb-3.5">
          <h3 className="text-sw-text text-[13px] font-bold mb-3">Recent Activity</h3>
          <div className="space-y-2">
            {recentActivity.map(a => {
              const color = a.action === 'create' ? 'text-sw-green' : a.action === 'update' ? 'text-sw-blue' : 'text-sw-red';
              const icon = a.action === 'create' ? '➕' : a.action === 'update' ? '✎' : '✕';
              return (
                <div key={a.id} className="flex items-start gap-2 text-[12px]">
                  <span className={`${color} font-bold flex-shrink-0 w-5 text-center`}>{icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sw-text truncate">{a.description}</div>
                    <div className="text-sw-dim text-[10px]">
                      {a.user_name} · {new Date(a.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
