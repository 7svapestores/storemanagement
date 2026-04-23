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
        let todayQ = supabase.from('daily_sales').select('store_id, total_sales, gross_sales').eq('date', todayStr);
        if (storeId) todayQ = todayQ.eq('store_id', storeId);
        const { data: todayRows } = await todayQ;
        setTodaySales(todayRows || []);

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

      {/* Store filter pills */}
      <StorePills stores={stores} value={selectedStore} onChange={setSelectedStore} />

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
          <p className="text-[var(--text-muted)] text-[12px] mt-1">
            Margin: <span className={stats.margin >= 20 ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'}>{stats.margin.toFixed(1)}%</span>
            {(() => {
              const now = new Date();
              const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
              const daysPassed = now.getDate();
              const daysLeft = daysInMonth - daysPassed;
              const dailyAvg = daysPassed > 0 ? stats.netProfit / daysPassed : 0;
              const projected = dailyAvg * daysInMonth;
              return (
                <span className="ml-3">
                  · {daysLeft}d left · Pace: <span className={projected >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}>{fmt(projected)}/mo</span>
                </span>
              );
            })()}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-[var(--border-subtle)]">
            <div><p className="text-[var(--text-muted)] text-[10px] uppercase font-semibold">Revenue</p><p className="text-[var(--text-primary)] text-[16px] font-bold tabular-nums">{fmt(stats.totalNet)}</p></div>
            <div><p className="text-[var(--text-muted)] text-[10px] uppercase font-semibold">Product Buying</p><p className="text-[var(--color-warning)] text-[16px] font-bold tabular-nums">{fmt(stats.totalPurch)}</p></div>
            <div><p className="text-[var(--text-muted)] text-[10px] uppercase font-semibold">Expenses</p><p className="text-[var(--color-danger)] text-[16px] font-bold tabular-nums">{fmt(stats.totalExp)}</p></div>
            <div><p className="text-[var(--text-muted)] text-[10px] uppercase font-semibold">Tax Collected</p><p className="text-[var(--color-info)] text-[16px] font-bold tabular-nums">{fmt(stats.totalTax)}</p></div>
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
          <SectionHeader title="Attention Needed" />
          <div className="space-y-2">
            {alerts.map((a, i) => (
              <div key={i} className="w-full flex items-center gap-3 p-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                <span className="text-[16px]">{a.type === 'danger' ? '🔴' : a.type === 'warning' ? '🟡' : 'ℹ️'}</span>
                <span className="text-[var(--text-primary)] text-[12px] font-medium flex-1">{a.text}</span>
              </div>
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
              <thead><tr><th>#</th><th>Store</th><th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>Product Buying</th><th style={{ textAlign: 'right' }}>Expenses</th><th style={{ textAlign: 'right' }}>Profit</th><th style={{ textAlign: 'right' }}>Margin</th></tr></thead>
              <tbody>
                {sortedStores.map((s, i) => (
                  <tr key={s.id} style={i === 0 ? { background: 'rgba(251,191,36,0.06)' } : undefined}>
                    <td className="text-[var(--text-muted)] text-center">{i === 0 ? '🏆' : i + 1}</td>
                    <td><span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} /><span className="text-[var(--text-primary)] font-semibold text-[13px]">{s.name?.split(' - ').pop()?.trim() || s.name}</span></span></td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} className="text-[var(--text-primary)] font-semibold">{fmt(s.revenue)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} className="text-[var(--color-warning)]">{fmt(s.buying)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} className="text-[var(--color-danger)]">{fmt(s.expenses)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} className={`font-bold ${s.profit >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>{fmt(s.profit)}</td>
                    <td style={{ textAlign: 'right' }} className={`font-semibold ${s.margin >= 40 ? 'text-[var(--color-success)]' : s.margin >= 20 ? 'text-[var(--color-warning)]' : 'text-[var(--color-danger)]'}`}>{s.margin.toFixed(1)}%</td>
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
