'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { DateBar, useDateRange, TrendChart, Loading, StorePills } from '@/components/UI';
import { Card, V2StatCard, Badge, V2Alert, SectionHeader } from '@/components/ui';
import { fmt, weekRangeLabel, startOfWeekMonday, today } from '@/lib/utils';

function greeting(name) {
  const h = new Date().getHours();
  const g = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : h < 23 ? 'Good evening' : 'Good night';
  return `${g}, ${name || 'Owner'}`;
}
const dayStr = () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

export default function DashboardPage() {
  const router = useRouter();
  const { supabase, isOwner, profile, effectiveStoreId } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('thismonth');
  const [selectedStore, setSelectedStore] = useState('');
  const [stats, setStats] = useState(null);
  const [trends, setTrends] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [todaySales, setTodaySales] = useState([]);
  const [todayLastWeek, setTodayLastWeek] = useState([]);
  const [nrsStatus, setNrsStatus] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [storePerf, setStorePerf] = useState([]);
  const [topEmployees, setTopEmployees] = useState([]);
  const [storeSort, setStoreSort] = useState('revenue');

  const storeId = selectedStore || effectiveStoreId;

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

        let cashQ = supabase.from('cash_collections').select('cash_collected, store_id')
          .gte('date', range.start).lte('date', range.end);
        if (storeId) cashQ = cashQ.eq('store_id', storeId);
        const { data: cashRows } = await cashQ;

        const totalGross = sales?.reduce((s, r) => s + (r.gross_sales ?? r.total_sales ?? 0), 0) || 0;
        const totalCash = sales?.reduce((s, r) => s + (r.cash_sales || 0) + (r.register2_cash || 0), 0) || 0;
        const totalCard = sales?.reduce((s, r) => s + (r.card_sales || 0) + (r.register2_card || 0), 0) || 0;
        const totalNet = sales?.reduce((s, r) => s + (r.total_sales ?? r.net_sales ?? 0), 0) || 0;
        const totalShortOver = sales?.reduce((s, r) => s + (r.short_over || 0), 0) || 0;
        const totalTax = sales?.reduce((s, r) => s + (r.tax_collected || 0), 0) || 0;
        const totalPurch = purch?.reduce((s, r) => s + (r.total_cost || r.unit_cost || 0), 0) || 0;
        const totalExp = exps?.reduce((s, r) => s + (r.amount || 0), 0) || 0;
        const cashInHand = cashRows?.reduce((s, r) => s + (r.cash_collected || 0), 0) || 0;
        const netProfit = totalNet - totalPurch - totalExp;
        const margin = totalNet > 0 ? (netProfit / totalNet * 100) : 0;

        setStats({ totalGross, totalNet, totalCash, totalCard, totalShortOver, totalTax, totalPurch, totalExp, cashInHand, netProfit, margin });

        if (storeData?.length && !storeId) {
          const perf = storeData.map(st => {
            const rev = (sales || []).filter(r => r.store_id === st.id).reduce((s, r) => s + (r.total_sales ?? r.net_sales ?? 0), 0);
            const cogs = (purch || []).filter(r => r.store_id === st.id).reduce((s, r) => s + (r.total_cost || r.unit_cost || 0), 0);
            const exp = (exps || []).filter(r => r.store_id === st.id).reduce((s, r) => s + (r.amount || 0), 0);
            const so = (sales || []).filter(r => r.store_id === st.id).reduce((s, r) => s + (r.short_over || 0), 0);
            const profit = rev - cogs - exp;
            const mg = rev > 0 ? (profit / rev * 100) : 0;
            return { ...st, revenue: rev, buying: cogs, expenses: exp, profit, margin: mg, shortOver: so };
          }).sort((a, b) => b.revenue - a.revenue);
          setStorePerf(perf);
        } else {
          // When scoped to a specific store, the per-store ranking doesn't
          // make sense — clear it so the Store Performance card stays hidden.
          setStorePerf([]);
          setTopEmployees([]);
        }

        // Always bucket by Monday–Sunday weeks. Key = Monday of the week.
        const weekMap = {};
        const seed = new Date(startOfWeekMonday(range.start) + 'T12:00:00');
        const endAt = new Date(range.end + 'T12:00:00');
        while (seed <= endAt) {
          weekMap[startOfWeekMonday(seed)] = { sales: 0, purchases: 0 };
          seed.setDate(seed.getDate() + 7);
        }
        sales?.forEach(s => {
          const wk = startOfWeekMonday(s.date);
          if (!weekMap[wk]) weekMap[wk] = { sales: 0, purchases: 0 };
          weekMap[wk].sales += (s.total_sales ?? s.net_sales ?? 0);
        });
        purch?.forEach(p => {
          const wk = startOfWeekMonday(p.week_of);
          if (!weekMap[wk]) weekMap[wk] = { sales: 0, purchases: 0 };
          weekMap[wk].purchases += (p.total_cost || p.unit_cost || 0);
        });
        setTrends(Object.entries(weekMap)
          .map(([key, d]) => ({ week: key, ...d, diff: (d.sales || 0) - (d.purchases || 0), label: weekRangeLabel(key) }))
          .sort((a, b) => a.week.localeCompare(b.week)));

        const todayStr = today();
        // Same calendar day one week ago, for the live-bar vs-last-week delta.
        const lastWeekStr = (() => {
          const d = new Date(todayStr + 'T12:00:00'); d.setDate(d.getDate() - 7);
          const y = d.getFullYear(); const mo = String(d.getMonth()+1).padStart(2,'0'); const da = String(d.getDate()).padStart(2,'0');
          return `${y}-${mo}-${da}`;
        })();
        let todayQ = supabase.from('daily_sales').select('store_id, total_sales, gross_sales').eq('date', todayStr);
        let lastWeekQ = supabase.from('daily_sales').select('total_sales, gross_sales').eq('date', lastWeekStr);
        if (storeId) { todayQ = todayQ.eq('store_id', storeId); lastWeekQ = lastWeekQ.eq('store_id', storeId); }
        const [{ data: todayRows }, { data: lastWeekRows }] = await Promise.all([todayQ, lastWeekQ]);
        setTodaySales(todayRows || []);
        setTodayLastWeek(lastWeekRows || []);

        // Top employees — only fetched in multi-store mode; cleared above
        // when a specific store is selected.
        let shiftQ = supabase
          .from('employee_shifts')
          .select('employee_name, store_id, daily_sales(total_sales, net_sales)')
          .gte('shift_date', range.start).lte('shift_date', range.end);
        if (storeId) shiftQ = shiftQ.eq('store_id', storeId);
        const { data: shifts } = storeId ? { data: [] } : await shiftQ;
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
  }, [range.start, range.end, storeId, selectedStore]);

  const paymentMix = useMemo(() => {
    if (!stats || stats.totalGross <= 0) return null;
    const total = stats.totalCash + stats.totalCard;
    if (total <= 0) return null;
    return { cash: stats.totalCash, card: stats.totalCard, cashPct: (stats.totalCash / total * 100).toFixed(0), cardPct: (stats.totalCard / total * 100).toFixed(0) };
  }, [stats]);

  // Alerts — when scoped to a specific store, only show alerts for that store.
  const alerts = useMemo(() => {
    const a = [];
    storePerf.forEach(s => {
      if (s.margin < 40 && s.revenue > 100) a.push({ type: 'warning', text: `${s.name} margin only ${s.margin.toFixed(0)}%`, link: '/reports' });
      if (Math.abs(s.shortOver) > 50) {
        const short = s.shortOver > 0;
        a.push({
          type: short ? 'danger' : 'warning',
          text: `${s.name} short/over: ${short ? '−' : '+'}${fmt(Math.abs(s.shortOver))}`,
          link: '/cash',
        });
      }
    });
    const relevantStores = storeId ? stores.filter(st => st.id === storeId) : stores;
    const missingToday = relevantStores.filter(st => !todaySales.find(r => r.store_id === st.id));
    if (missingToday.length > 0) {
      a.push({
        type: 'info',
        text: storeId
          ? `${missingToday[0].name} has no entry for today yet`
          : `${missingToday.length} store${missingToday.length > 1 ? 's' : ''} missing today's entry`,
        link: '/sales',
      });
    }
    // Scoped mode: surface this store's own short/over if material.
    if (storeId && stats && Math.abs(stats.totalShortOver) > 50) {
      // Positive short_over = SHORT (missing cash → danger).
      // Negative = OVER (extra cash → warning — still worth a review).
      const short = stats.totalShortOver > 0;
      a.push({
        type: short ? 'danger' : 'warning',
        text: `Short/over: ${short ? '−' : '+'}${fmt(Math.abs(stats.totalShortOver))}`,
        link: '/cash',
      });
    }
    return a;
  }, [storePerf, stores, todaySales, storeId, stats]);

  const sortedStores = useMemo(() => {
    const s = [...storePerf];
    if (storeSort === 'revenue') s.sort((a, b) => b.revenue - a.revenue);
    else if (storeSort === 'profit') s.sort((a, b) => b.profit - a.profit);
    else if (storeSort === 'margin') s.sort((a, b) => b.margin - a.margin);
    else if (storeSort === 'name') s.sort((a, b) => a.name.localeCompare(b.name));
    return s;
  }, [storePerf, storeSort]);

  if (loading) return <Loading />;

  // Daily-avg denominator = days between the range start and the last
  // synced date (not today), so partial/un-synced days don't dilute it.
  const avgEnd = lastSync?.date && lastSync.date < range.end ? lastSync.date : range.end;
  const rangeDays = Math.max(1, Math.round((new Date(avgEnd + 'T12:00:00') - new Date(range.start + 'T12:00:00')) / 86400000) + 1);
  const dailyAvg = stats ? (stats.totalNet || 0) / rangeDays : 0;

  // Today totals + vs-last-week delta for the live status bar.
  const totalToday = todaySales.reduce((s, r) => s + (r.total_sales ?? r.gross_sales ?? 0), 0);
  const totalLastWeek = todayLastWeek.reduce((s, r) => s + (r.total_sales ?? r.gross_sales ?? 0), 0);
  const todayDeltaPct = totalLastWeek > 0 ? ((totalToday - totalLastWeek) / totalLastWeek) * 100 : null;

  // Month progress for the hero progress bar — a stand-in for a real
  // target until we wire per-store monthly goals into settings.
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysPassed = now.getDate();
  const daysLeft = Math.max(0, daysInMonth - daysPassed);
  const monthProgressPct = Math.round((daysPassed / daysInMonth) * 100);
  const projectedNet = stats && daysPassed > 0 ? (stats.netProfit / daysPassed) * daysInMonth : 0;

  const relativeTime = (iso) => {
    if (!iso) return '';
    const then = new Date(iso);
    const sec = Math.max(1, Math.round((Date.now() - then.getTime()) / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 48) return `${hr}h ago`;
    return `${Math.round(hr / 24)}d ago`;
  };

  return (
    <div>
      {/* Live status bar */}
      <div className="flex items-center gap-x-5 gap-y-2 flex-wrap px-4 py-2 mb-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[12px]">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[var(--color-success)] animate-pulse" />
          <span className="text-[var(--color-success)] font-semibold">Live</span>
        </span>
        <span className="text-[var(--text-muted)]">
          Today <span className="text-[var(--text-primary)] font-semibold tabular-nums">{fmt(totalToday)}</span>
          {todayDeltaPct != null && (
            <span className={`ml-1.5 font-semibold ${todayDeltaPct >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
              {todayDeltaPct >= 0 ? '+' : ''}{todayDeltaPct.toFixed(1)}%
            </span>
          )}
        </span>
        {alerts.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[var(--color-warning)]" />
            <span className="text-[var(--color-warning)] font-semibold">{alerts.length} alert{alerts.length === 1 ? '' : 's'}</span>
          </span>
        )}
        {isOwner && nrsStatus !== null && (
          <span className={`flex items-center gap-1.5 ${nrsStatus ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
            <span className={`w-2 h-2 rounded-full ${nrsStatus ? 'bg-[var(--color-success)]' : 'bg-[var(--color-danger)]'}`} />
            <span className="font-semibold">{nrsStatus ? 'NRS Connected' : 'NRS Invalid'}</span>
          </span>
        )}
        {lastSync && (
          <span className="text-[var(--text-muted)] ml-auto">
            Synced <span className="text-[var(--text-secondary)]">{relativeTime(lastSync.time)}</span>
          </span>
        )}
      </div>

      {/* Greeting */}
      <div className="mb-4">
        <p className="text-[var(--text-muted)] text-[12px] font-semibold">{dayStr()}</p>
        <h1 className="text-[var(--text-primary)] text-[24px] font-bold tracking-tight">{greeting(profile?.name)}</h1>
      </div>

      {/* Store filter pills */}
      <StorePills stores={stores} value={selectedStore} onChange={setSelectedStore} />

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      {loadError && <V2Alert type="danger" className="mb-3">{loadError}</V2Alert>}

      {/* Hero: Net Profit + Margin + Pace */}
      {stats && (
        <Card
          padding="lg"
          className="mb-5 relative overflow-hidden"
          style={{
            background: stats.netProfit >= 0
              ? 'linear-gradient(135deg, rgba(52,211,153,0.14), rgba(52,211,153,0.03))'
              : 'linear-gradient(135deg, rgba(248,113,113,0.14), rgba(248,113,113,0.03))',
            borderColor: stats.netProfit >= 0 ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)',
          }}
        >
          <div className="absolute top-0 right-0 w-48 h-48 rounded-full opacity-10" style={{ background: `radial-gradient(circle, ${stats.netProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}, transparent 70%)`, filter: 'blur(40px)' }} />
          <p className="text-[var(--text-muted)] text-[11px] font-semibold uppercase tracking-wider mb-1">
            Net Profit · {new Date(range.start + 'T12:00:00').toLocaleDateString('en-US', { month: 'long' })}
          </p>
          <div className="flex items-end gap-6 flex-wrap">
            <p className={`text-[44px] font-bold tracking-tight tabular-nums leading-none ${stats.netProfit >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
              {stats.netProfit >= 0 ? '' : '−'}{fmt(Math.abs(stats.netProfit))}
            </p>
            <div className="text-[12px] text-[var(--text-secondary)] pb-1">
              Margin <span className={`font-bold ${stats.margin >= 20 ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'}`}>{stats.margin.toFixed(1)}%</span>
              <span className="mx-2 text-[var(--text-muted)]">·</span>
              Pace <span className={`font-bold tabular-nums ${projectedNet >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>{fmt(projectedNet)}/mo</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="h-2 rounded-full bg-[var(--bg-card)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${monthProgressPct}%`,
                  background: stats.netProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                }}
              />
            </div>
            <div className="flex justify-between mt-1.5 text-[11px] text-[var(--text-muted)]">
              <span>{monthProgressPct}% of the month</span>
              <span>{daysLeft} day{daysLeft === 1 ? '' : 's'} left</span>
            </div>
          </div>
        </Card>
      )}

      {/* Stat Cards */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5 items-stretch">
          <V2StatCard
            className="h-full"
            label="Gross Sales"
            value={fmt(stats.totalGross)}
            variant="success"
            icon="💰"
            sub={<TwoLineSub lines={[
              { label: 'Cash', value: fmt(stats.totalCash), color: 'text-[var(--color-success)]' },
              { label: 'Card', value: fmt(stats.totalCard), color: 'text-[var(--color-info)]' },
            ]} />}
          />
          <V2StatCard
            className="h-full"
            label="Total Sales"
            value={fmt(stats.totalNet)}
            variant="success"
            icon="📊"
            sub={<TwoLineSub lines={[
              { label: 'Daily avg', value: fmt(dailyAvg) },
              { label: 'Days tracked', value: String(rangeDays) },
            ]} />}
          />
          {(() => {
            // Convention: positive short_over = SHORT (missing cash, red with −),
            // negative = OVER (extra cash, green with +), zero = matched.
            const n = stats.totalShortOver;
            const matched = Math.abs(n) < 0.01;
            const short = n > 0;
            const displayValue = matched ? fmt(0) : (short ? `−${fmt(Math.abs(n))}` : `+${fmt(Math.abs(n))}`);
            const variant = matched ? 'default' : short ? 'danger' : 'success';
            const icon = matched ? '⚖️' : short ? '🔴' : '🟢';
            return <V2StatCard className="h-full" label="Short / Over" value={displayValue} variant={variant} icon={icon} />;
          })()}
          {(() => {
            const expected = stats.totalCash || 0;
            const collected = stats.cashInHand || 0;
            const d = collected - expected;
            const matched = Math.abs(d) < 0.01;
            const short = d < 0;
            const diffColor = matched
              ? 'text-[var(--text-muted)]'
              : short ? 'text-[var(--color-danger)]' : 'text-[var(--color-success)]';
            const diffLabel = matched ? 'Matched' : (short ? 'Short' : 'Over');
            return (
              <V2StatCard
                className="h-full"
                label="Cash in Hand"
                value={fmt(collected)}
                variant="info"
                icon="🏦"
                sub={<TwoLineSub lines={[
                  { label: 'Expected', value: fmt(expected), color: 'text-[var(--color-info)]' },
                  { label: diffLabel, value: matched ? '—' : fmt(Math.abs(d)), color: diffColor },
                ]} />}
              />
            );
          })()}
        </div>
      )}

      {/* Attention Needed */}
      {alerts.length > 0 ? (
        <Card padding="md" className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-[var(--text-primary)] text-[14px] font-bold">Attention needed</h2>
            <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-[var(--color-danger-bg)] text-[var(--color-danger)]">{alerts.length}</span>
          </div>
          <div className="space-y-2">
            {alerts.map((a, i) => {
              const accent = a.type === 'danger' ? 'var(--color-danger)' : a.type === 'warning' ? 'var(--color-warning)' : 'var(--color-info)';
              const cta = a.type === 'danger' ? 'Fix now' : 'Review';
              const btnClasses = a.type === 'danger'
                ? 'bg-[var(--color-danger)] text-white'
                : 'border border-[var(--color-warning)] text-[var(--color-warning)] bg-transparent';
              return (
                <div
                  key={i}
                  className="w-full flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)]"
                  style={{ borderLeft: `3px solid ${accent}` }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[var(--text-primary)] text-[13px] font-semibold truncate">{a.text}</p>
                  </div>
                  <button
                    onClick={() => a.link && router.push(a.link)}
                    className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-90 ${btnClasses}`}
                  >
                    {cta}
                  </button>
                </div>
              );
            })}
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
          {(() => {
            const totalSales = trends.reduce((s, d) => s + (d.sales || 0), 0);
            const totalPurch = trends.reduce((s, d) => s + (d.purchases || 0), 0);
            return (
              <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                <div>
                  <h3 className="text-[var(--text-primary)] text-[14px] font-bold">Weekly Sales vs Purchases</h3>
                  <p className="text-[var(--text-muted)] text-[11px] mt-0.5">
                    Monday–Sunday weeks · {range.start} to {range.end}
                  </p>
                </div>
                <div className="flex gap-4 text-[11px]">
                  <div className="text-right">
                    <div className="text-[var(--text-muted)] uppercase font-semibold text-[9px]">Total Sales</div>
                    <div className="text-[var(--color-success)] font-mono font-bold tabular-nums">{fmt(totalSales)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[var(--text-muted)] uppercase font-semibold text-[9px]">Total Purchases</div>
                    <div className="text-[var(--color-warning)] font-mono font-bold tabular-nums">{fmt(totalPurch)}</div>
                  </div>
                </div>
              </div>
            );
          })()}
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

      {/* Store Performance — cards with inline share-of-revenue bar */}
      {sortedStores.length > 0 && (() => {
        const maxRevenue = Math.max(1, ...sortedStores.map(s => s.revenue));
        return (
          <Card padding="md" className="mb-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[var(--text-primary)] text-[14px] font-bold">Store performance</h2>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase text-[var(--text-muted)] tracking-wider">Sorted by</span>
                <select value={storeSort} onChange={e => setStoreSort(e.target.value)} className="!w-auto !min-w-0 !py-1 !px-2 !text-[10px]">
                  <option value="revenue">Revenue</option>
                  <option value="profit">Profit</option>
                  <option value="margin">Margin</option>
                  <option value="name">Name</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              {sortedStores.map((s, i) => {
                const shortName = s.name?.split(' - ').pop()?.trim() || s.name;
                const share = (s.revenue / maxRevenue) * 100;
                const marginColor = s.margin >= 40 ? 'var(--color-success)' : s.margin >= 20 ? 'var(--color-warning)' : 'var(--color-danger)';
                return (
                  <div
                    key={s.id}
                    className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 items-center p-2.5 rounded-lg"
                    style={i === 0 ? { background: 'rgba(251,191,36,0.06)' } : undefined}
                  >
                    <span className="w-6 text-center text-[var(--text-muted)] font-semibold">
                      {i === 0 ? '🏆' : i + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: s.color }} />
                        <span className="text-[var(--text-primary)] font-semibold text-[13px] truncate">{shortName}</span>
                      </div>
                      <div className="h-1 rounded-full bg-[var(--bg-card)] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${share}%`, background: s.color }} />
                      </div>
                    </div>
                    <span className="text-[var(--text-primary)] font-mono font-semibold tabular-nums text-[13px] text-right w-20">{fmt(s.revenue)}</span>
                    <span className={`font-mono font-bold tabular-nums text-[13px] text-right w-20 ${s.profit >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>{fmt(s.profit)}</span>
                    <span
                      className="text-[11px] font-bold rounded-md px-2 py-0.5 tabular-nums"
                      style={{ background: marginColor + '22', color: marginColor }}
                    >
                      {s.margin.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })()}

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
                  <span className="text-[var(--color-success)] font-mono font-bold text-[13px] tabular-nums">{fmt(e.sales)}</span>
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

// Two-line stat-card sub with aligned label/value rows. Label is muted on
// the left, value on the right with its own color.
function TwoLineSub({ lines }) {
  return (
    <span className="block space-y-0.5">
      {lines.map((l, i) => (
        <span key={i} className="flex items-baseline justify-between gap-2">
          <span className="text-[var(--text-muted)]">{l.label}</span>
          <span className={`font-semibold tabular-nums ${l.color || 'text-[var(--text-primary)]'}`}>{l.value}</span>
        </span>
      ))}
    </span>
  );
}
