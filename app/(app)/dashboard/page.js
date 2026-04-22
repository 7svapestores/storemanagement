'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { DateBar, useDateRange, TrendChart, Loading } from '@/components/UI';
import { Card, V2StatCard, Badge, V2Alert, SectionHeader } from '@/components/ui';
import { fK, fmt, weekLabel, today } from '@/lib/utils';

function greeting(name) {
  const h = new Date().getHours();
  const g = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : h < 23 ? 'Good evening' : 'Good night';
  return `${g}, ${name || 'Owner'}`;
}
const dayStr = () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

export default function DashboardPage() {
  const router = useRouter();
  const { supabase, isOwner, profile, effectiveStoreId } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('last30');
  const [stats, setStats] = useState(null);
  const [trends, setTrends] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [todaySales, setTodaySales] = useState([]);
  const [nrsStatus, setNrsStatus] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [storePerf, setStorePerf] = useState([]);
  const [topEmployees, setTopEmployees] = useState([]);
  const [storeSort, setStoreSort] = useState('revenue');

  const storeId = effectiveStoreId;

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const { data: storeData } = await supabase.from('stores').select('*').order('created_at');
        setStores(storeData || []);

        fetch('/api/nrs/validate').then(r => r.json()).then(d => setNrsStatus(d?.valid === true)).catch(() => setNrsStatus(false));
        supabase.from('nrs_sync_log').select('sync_date, status, created_at').order('created_at', { ascending: false }).limit(10)
          .then(({ data: syncLogs }) => {
            if (!syncLogs?.length) return;
            const latest = syncLogs[0];
            setLastSync({
              date: latest.sync_date, time: latest.created_at,
              success: syncLogs.filter(l => l.status === 'success' && l.sync_date === latest.sync_date).length,
              failed: syncLogs.filter(l => l.status === 'failed' && l.sync_date === latest.sync_date).length,
            });
          });

        let salesQ = supabase.from('daily_sales')
          .select('cash_sales, card_sales, register2_cash, register2_card, total_sales, gross_sales, net_sales, short_over, credits, tax_collected, date, store_id')
          .gte('date', range.start).lte('date', range.end);
        if (storeId) salesQ = salesQ.eq('store_id', storeId);
        const { data: sales } = await salesQ;

        let purchQ = supabase.from('purchases').select('total_cost, unit_cost, week_of, store_id')
          .gte('week_of', range.start).lte('week_of', range.end);
        if (storeId) purchQ = purchQ.eq('store_id', storeId);
        const { data: purch } = await purchQ;

        let expQ = supabase.from('expenses').select('amount, store_id');
        if (storeId) expQ = expQ.eq('store_id', storeId);
        const { data: exps } = await expQ;

        const totalGross = sales?.reduce((s, r) => s + (r.gross_sales ?? r.total_sales ?? 0), 0) || 0;
        const totalCash = sales?.reduce((s, r) => s + (r.cash_sales || 0) + (r.register2_cash || 0), 0) || 0;
        const totalCard = sales?.reduce((s, r) => s + (r.card_sales || 0) + (r.register2_card || 0), 0) || 0;
        const totalNet = sales?.reduce((s, r) => s + (r.total_sales ?? r.net_sales ?? 0), 0) || 0;
        const totalShortOver = sales?.reduce((s, r) => s + (r.short_over || 0), 0) || 0;
        const totalTax = sales?.reduce((s, r) => s + (r.tax_collected || 0), 0) || 0;
        const totalPurch = purch?.reduce((s, r) => s + (r.total_cost || r.unit_cost || 0), 0) || 0;
        const totalExp = exps?.reduce((s, r) => s + (r.amount || 0), 0) || 0;
        const netProfit = totalNet - totalPurch - totalExp;
        const margin = totalNet > 0 ? (netProfit / totalNet * 100) : 0;

        setStats({ totalGross, totalNet, totalCash, totalCard, totalShortOver, totalTax, totalPurch, totalExp, netProfit, margin });

        if (storeData?.length && !storeId) {
          const perf = storeData.map(st => {
            const rev = (sales || []).filter(r => r.store_id === st.id).reduce((s, r) => s + (r.total_sales ?? r.net_sales ?? 0), 0);
            const cogs = (purch || []).filter(r => r.store_id === st.id).reduce((s, r) => s + (r.total_cost || r.unit_cost || 0), 0);
            const exp = (exps || []).filter(r => r.store_id === st.id).reduce((s, r) => s + (r.amount || 0), 0);
            const so = (sales || []).filter(r => r.store_id === st.id).reduce((s, r) => s + (r.short_over || 0), 0);
            const profit = rev - cogs - exp;
            const mg = rev > 0 ? (profit / rev * 100) : 0;
            return { ...st, revenue: rev, profit, margin: mg, shortOver: so };
          }).sort((a, b) => b.revenue - a.revenue);
          setStorePerf(perf);
        }

        const weekMap = {};
        sales?.forEach(s => {
          const d = new Date(s.date); const day = d.getDay();
          d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
          const wk = d.toISOString().split('T')[0];
          weekMap[wk] = { ...(weekMap[wk] || { sales: 0, purchases: 0 }), sales: (weekMap[wk]?.sales || 0) + (s.total_sales || 0) };
        });
        purch?.forEach(p => {
          const wk = typeof p.week_of === 'string' ? p.week_of.split('T')[0] : new Date(p.week_of).toISOString().split('T')[0];
          weekMap[wk] = { ...(weekMap[wk] || { sales: 0, purchases: 0 }), purchases: (weekMap[wk]?.purchases || 0) + (p.total_cost || p.unit_cost || 0) };
        });
        setTrends(Object.entries(weekMap).map(([week, d]) => ({ week, ...d, diff: d.sales - d.purchases, label: weekLabel(week) })).sort((a, b) => a.week.localeCompare(b.week)));

        const todayStr = today();
        let todayQ = supabase.from('daily_sales').select('store_id, total_sales, gross_sales').eq('date', todayStr);
        if (storeId) todayQ = todayQ.eq('store_id', storeId);
        const { data: todayRows } = await todayQ;
        setTodaySales(todayRows || []);

        // Top employees
        const { data: shifts } = await supabase
          .from('employee_shifts')
          .select('employee_name, store_id, daily_sales(total_sales, net_sales)')
          .gte('shift_date', range.start).lte('shift_date', range.end);
        if (shifts?.length) {
          const empMap = {};
          shifts.forEach(s => {
            const sales = Number(s.daily_sales?.total_sales ?? s.daily_sales?.net_sales ?? 0);
            const k = `${s.employee_name}|${s.store_id}`;
            if (!empMap[k]) empMap[k] = { name: s.employee_name, storeId: s.store_id, sales: 0, shifts: 0 };
            empMap[k].sales += sales;
            empMap[k].shifts++;
          });
          const top = Object.values(empMap).sort((a, b) => b.sales - a.sales).slice(0, 3);
          setTopEmployees(top.map(e => ({ ...e, storeName: storeData?.find(s => s.id === e.storeId)?.name || '—' })));
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

  const paymentMix = useMemo(() => {
    if (!stats || stats.totalGross <= 0) return null;
    const total = stats.totalCash + stats.totalCard;
    if (total <= 0) return null;
    return { cash: stats.totalCash, card: stats.totalCard, cashPct: (stats.totalCash / total * 100).toFixed(0), cardPct: (stats.totalCard / total * 100).toFixed(0) };
  }, [stats]);

  // Alerts
  const alerts = useMemo(() => {
    const a = [];
    storePerf.forEach(s => {
      if (s.margin < 40 && s.revenue > 100) a.push({ type: 'warning', text: `${s.name} margin only ${s.margin.toFixed(0)}%`, link: '/reports' });
      if (Math.abs(s.shortOver) > 50) a.push({ type: s.shortOver > 0 ? 'warning' : 'danger', text: `${s.name} short/over: ${s.shortOver > 0 ? '-' : '+'}${fmt(Math.abs(s.shortOver))}`, link: '/cash' });
    });
    const missingToday = stores.filter(st => !todaySales.find(r => r.store_id === st.id));
    if (missingToday.length > 0) a.push({ type: 'info', text: `${missingToday.length} store${missingToday.length > 1 ? 's' : ''} missing today's entry`, link: '/sales' });
    return a;
  }, [storePerf, stores, todaySales]);

  const sortedStores = useMemo(() => {
    const s = [...storePerf];
    if (storeSort === 'revenue') s.sort((a, b) => b.revenue - a.revenue);
    else if (storeSort === 'profit') s.sort((a, b) => b.profit - a.profit);
    else if (storeSort === 'margin') s.sort((a, b) => b.margin - a.margin);
    else if (storeSort === 'name') s.sort((a, b) => a.name.localeCompare(b.name));
    return s;
  }, [storePerf, storeSort]);

  if (loading) return <Loading />;

  const totalToday = todaySales.reduce((s, r) => s + (r.total_sales ?? r.gross_sales ?? 0), 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <p className="text-[var(--text-muted)] text-[12px] font-semibold">{dayStr()}</p>
          <h1 className="text-[var(--text-primary)] text-[24px] font-bold tracking-tight">{greeting(profile?.name)}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isOwner && nrsStatus !== null && (
            <Badge variant={nrsStatus ? 'success' : 'danger'}>
              {nrsStatus ? '🤖 NRS Connected' : '✕ NRS Invalid'}
            </Badge>
          )}
          {lastSync && (
            <Badge variant="default">
              Sync: {lastSync.date} · {lastSync.success}/{lastSync.success + lastSync.failed}
            </Badge>
          )}
        </div>
      </div>

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      {loadError && <V2Alert type="danger" className="mb-3">{loadError}</V2Alert>}

      {/* Hero: Net Profit */}
      {stats && (
        <Card padding="lg" className="mb-5 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(94,106,210,0.15), rgba(139,92,246,0.08))' }}>
          <div className="absolute top-0 right-0 w-48 h-48 rounded-full opacity-10" style={{ background: 'radial-gradient(circle, var(--brand-primary), transparent 70%)', filter: 'blur(40px)' }} />
          <p className="text-[var(--text-muted)] text-[11px] font-semibold uppercase tracking-wider mb-1">Net Profit · {range.start} to {range.end}</p>
          <p className={`text-[40px] font-bold tracking-tight tabular-nums ${stats.netProfit >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
            {stats.netProfit >= 0 ? '' : '−'}{fmt(Math.abs(stats.netProfit))}
          </p>
          <p className="text-[var(--text-muted)] text-[12px] mt-1">Margin: <span className={stats.margin >= 20 ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'}>{stats.margin.toFixed(1)}%</span></p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-[var(--border-subtle)]">
            <div><p className="text-[var(--text-muted)] text-[10px] uppercase font-semibold">Revenue</p><p className="text-[var(--text-primary)] text-[16px] font-bold tabular-nums">{fK(stats.totalNet)}</p></div>
            <div><p className="text-[var(--text-muted)] text-[10px] uppercase font-semibold">Product Buying</p><p className="text-[var(--color-warning)] text-[16px] font-bold tabular-nums">{fK(stats.totalPurch)}</p></div>
            <div><p className="text-[var(--text-muted)] text-[10px] uppercase font-semibold">Expenses</p><p className="text-[var(--color-danger)] text-[16px] font-bold tabular-nums">{fK(stats.totalExp)}</p></div>
            <div><p className="text-[var(--text-muted)] text-[10px] uppercase font-semibold">Tax Collected</p><p className="text-[var(--color-info)] text-[16px] font-bold tabular-nums">{fK(stats.totalTax)}</p></div>
          </div>
        </Card>
      )}

      {/* Stat Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <V2StatCard label="Gross Sales" value={fK(stats.totalGross)} variant="success" icon="💰" sub={`Cash ${fK(stats.totalCash)} · Card ${fK(stats.totalCard)}`} />
          <V2StatCard label="Total Sales" value={fK(stats.totalNet)} variant="success" icon="📊" />
          <V2StatCard label="Short / Over" value={`${stats.totalShortOver >= 0 ? '+' : ''}${fK(stats.totalShortOver)}`} variant={stats.totalShortOver < 0 ? 'danger' : stats.totalShortOver > 0 ? 'warning' : 'default'} icon={stats.totalShortOver < 0 ? '🔴' : stats.totalShortOver > 0 ? '🟡' : '⚖️'} />
          <V2StatCard label="Today" value={fmt(totalToday)} variant={totalToday > 0 ? 'success' : 'warning'} icon="📅" />
        </div>
      )}

      {/* Attention Needed */}
      {alerts.length > 0 ? (
        <Card padding="md" className="mb-5">
          <SectionHeader title="Attention Needed" />
          <div className="space-y-2">
            {alerts.map((a, i) => (
              <button key={i} onClick={() => router.push(a.link)} className="w-full flex items-center gap-3 p-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--color-info)] transition-colors text-left">
                <span className="text-[16px]">{a.type === 'danger' ? '🔴' : a.type === 'warning' ? '🟡' : 'ℹ️'}</span>
                <span className="text-[var(--text-primary)] text-[12px] font-medium flex-1">{a.text}</span>
                <span className="text-[var(--text-muted)] text-[10px]">→</span>
              </button>
            ))}
          </div>
        </Card>
      ) : stats && (
        <div className="mb-5 rounded-xl px-4 py-3 text-center text-[12px] font-semibold" style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)', border: '1px solid var(--color-success)' }}>
          ✅ All systems healthy
        </div>
      )}

      {/* Chart + Payment Mix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5">
        <Card padding="md" className="lg:col-span-2">
          <SectionHeader title="Weekly Sales vs Purchases" />
          <div className="max-w-full overflow-x-auto"><TrendChart data={trends} /></div>
        </Card>
        {paymentMix && (
          <Card padding="md">
            <SectionHeader title="Payment Mix" />
            <div className="flex flex-col items-center py-4">
              <div className="relative w-28 h-28">
                <div className="w-full h-full rounded-full" style={{ background: `conic-gradient(var(--color-info) 0% ${paymentMix.cardPct}%, var(--color-success) ${paymentMix.cardPct}% 100%)` }} />
                <div className="absolute inset-3 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center">
                  <span className="text-[var(--text-primary)] text-[13px] font-bold tabular-nums">{fmt(paymentMix.cash + paymentMix.card)}</span>
                </div>
              </div>
              <div className="flex gap-4 mt-3 text-[11px]">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[var(--color-info)]" />Card {paymentMix.cardPct}%</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[var(--color-success)]" />Cash {paymentMix.cashPct}%</span>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Store Performance */}
      {sortedStores.length > 0 && (
        <Card padding="md" className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[var(--text-primary)] text-[14px] font-bold">Store Performance</h2>
            <select value={storeSort} onChange={e => setStoreSort(e.target.value)} className="!w-auto !min-w-0 !py-1 !px-2 !text-[10px]">
              <option value="revenue">Revenue</option>
              <option value="profit">Profit</option>
              <option value="margin">Margin</option>
              <option value="name">Name</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table>
              <thead><tr><th>#</th><th>Store</th><th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>Profit</th><th style={{ textAlign: 'right' }}>Margin</th></tr></thead>
              <tbody>
                {sortedStores.map((s, i) => (
                  <tr key={s.id} onClick={() => router.push(`/reports`)} className="cursor-pointer" style={i === 0 ? { background: 'rgba(251,191,36,0.06)' } : undefined}>
                    <td className="text-[var(--text-muted)] text-center">{i === 0 ? '🏆' : i + 1}</td>
                    <td><span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} /><span className="text-[var(--text-primary)] font-semibold text-[13px]">{s.name}</span></span></td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} className="text-[var(--color-success)] font-semibold">{fmt(s.revenue)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} className={`font-bold ${s.profit >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>{fmt(s.profit)}</td>
                    <td style={{ textAlign: 'right' }} className={`font-semibold ${s.margin >= 60 ? 'text-[var(--color-success)]' : s.margin >= 40 ? 'text-[var(--color-warning)]' : 'text-[var(--color-danger)]'}`}>{s.margin.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Top Employees + Quick Actions side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-5">
        {topEmployees.length > 0 && (
          <Card padding="md">
            <SectionHeader title="Top Employees" />
            <div className="space-y-2">
              {topEmployees.map((e, i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-[var(--bg-card)]">
                  <span className="text-[18px]">{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--text-primary)] text-[13px] font-semibold truncate">{e.name}</div>
                    <div className="text-[var(--text-muted)] text-[10px]">{e.storeName} · {e.shifts} shifts</div>
                  </div>
                  <span className="text-[var(--color-success)] font-mono font-bold text-[13px] tabular-nums">{fK(e.sales)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card padding="md">
          <SectionHeader title="Quick Actions" />
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Daily Sales', icon: '💰', href: '/sales' },
              { label: 'P&L Report', icon: '📑', href: '/reports' },
              { label: 'Cash Collection', icon: '🏦', href: '/cash' },
              { label: 'Employee Tracking', icon: '🕐', href: '/employee-tracking' },
              { label: 'Sync NRS', icon: '🤖', href: '/nrs-sync-history' },
              { label: 'Inventory Report', icon: '🛒', href: '/nrs-backfill' },
            ].map(a => (
              <button key={a.href} onClick={() => router.push(a.href)} className="flex items-center gap-2 p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--color-info)] transition-colors text-left">
                <span className="text-[16px]">{a.icon}</span>
                <span className="text-[var(--text-primary)] text-[12px] font-semibold">{a.label}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
