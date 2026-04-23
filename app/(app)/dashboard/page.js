'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { DateBar, useDateRange, TrendChart, Loading, StorePills } from '@/components/UI';
import { Card, Badge, SectionHeader } from '@/components/ui';
import { fmt, weekLabel, today } from '@/lib/utils';
import { LiveStatusBar, StatCardV2, AlertCardV2, StorePerformanceRow, HeroNetProfit, Sparkline } from './_components';

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
  const [prevTotals, setPrevTotals] = useState(null);
  const [clockedIn, setClockedIn] = useState(0);

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

        // Previous period — same span, ending just before range.start — for
        // KPI trend arrows.
        const rangeDays = Math.max(1, Math.round((new Date(range.end) - new Date(range.start)) / 86400000));
        const prevEnd = new Date(new Date(range.start).getTime() - 86400000).toISOString().slice(0, 10);
        const prevStart = new Date(new Date(prevEnd).getTime() - rangeDays * 86400000).toISOString().slice(0, 10);
        let prevSalesQ = supabase.from('daily_sales')
          .select('total_sales, net_sales, gross_sales, cash_sales, card_sales, register2_cash, register2_card, tax_collected')
          .gte('date', prevStart).lte('date', prevEnd);
        if (storeId) prevSalesQ = prevSalesQ.eq('store_id', storeId);
        let prevPurchQ = supabase.from('purchases').select('total_cost, unit_cost')
          .gte('week_of', prevStart).lte('week_of', prevEnd);
        if (storeId) prevPurchQ = prevPurchQ.eq('store_id', storeId);
        let prevExpQ = supabase.from('expenses').select('amount');
        if (storeId) prevExpQ = prevExpQ.eq('store_id', storeId);
        const [{ data: prevSales }, { data: prevPurch }, { data: prevExps }] = await Promise.all([prevSalesQ, prevPurchQ, prevExpQ]);
        const prevNet   = prevSales?.reduce((s, r) => s + (r.total_sales ?? r.net_sales ?? 0), 0) || 0;
        const prevGross = prevSales?.reduce((s, r) => s + (r.gross_sales ?? r.total_sales ?? 0), 0) || 0;
        const prevTax   = prevSales?.reduce((s, r) => s + (r.tax_collected || 0), 0) || 0;
        const prevPurchT = prevPurch?.reduce((s, r) => s + (r.total_cost || r.unit_cost || 0), 0) || 0;
        const prevExpT   = prevExps?.reduce((s, r) => s + (r.amount || 0), 0) || 0;
        const prevProfit = prevNet - prevPurchT - prevExpT;
        setPrevTotals({ net: prevNet, gross: prevGross, tax: prevTax, purch: prevPurchT, exp: prevExpT, profit: prevProfit });

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

        // Daily sparkline: aggregate totals by date so stat cards can show a
        // mini trend. One value per distinct day in the range.
        const daily = {};
        sales?.forEach(r => {
          const d = r.date;
          if (!daily[d]) daily[d] = { net: 0, gross: 0, tax: 0, cash: 0, card: 0 };
          daily[d].net   += r.total_sales ?? r.net_sales ?? 0;
          daily[d].gross += r.gross_sales ?? r.total_sales ?? 0;
          daily[d].tax   += r.tax_collected || 0;
          daily[d].cash  += (r.cash_sales || 0) + (r.register2_cash || 0);
          daily[d].card  += (r.card_sales || 0) + (r.register2_card || 0);
        });
        const dailyByDate = {};
        purch?.forEach(p => {
          const d = typeof p.week_of === 'string' ? p.week_of.split('T')[0] : new Date(p.week_of).toISOString().split('T')[0];
          dailyByDate[d] = (dailyByDate[d] || 0) + (p.total_cost || p.unit_cost || 0);
        });
        const sortedDays = Object.keys(daily).sort();
        const sparkNet   = sortedDays.map(d => daily[d].net);
        const sparkGross = sortedDays.map(d => daily[d].gross);
        const sparkTax   = sortedDays.map(d => daily[d].tax);
        // Rolling daily net profit approximation: daily net − daily purch for same date.
        const sparkProfit = sortedDays.map(d => (daily[d].net) - (dailyByDate[d] || 0));
        // Purchases sparkline lives on weekly dates; fall back to purch per week.
        const sparkPurch = sortedDays.map(d => dailyByDate[d] || 0);

        setStats({
          totalGross, totalNet, totalCash, totalCard, totalShortOver, totalTax, totalPurch, totalExp, netProfit, margin,
          sparkNet, sparkGross, sparkTax, sparkProfit, sparkPurch,
        });

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

        // Clocked-in: employee_shifts rows today without an end_time.
        let liveShiftQ = supabase
          .from('employee_shifts')
          .select('id, store_id, end_time, clock_out_time')
          .eq('shift_date', todayStr);
        if (storeId) liveShiftQ = liveShiftQ.eq('store_id', storeId);
        const { data: liveShifts } = await liveShiftQ;
        const live = (liveShifts || []).filter(s => !s.end_time && !s.clock_out_time).length;
        setClockedIn(live);

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
  // Shape: { severity, title, description, href }.
  const alerts = useMemo(() => {
    const a = [];
    storePerf.forEach(s => {
      if (Math.abs(s.shortOver) > 50) {
        const critical = Math.abs(s.shortOver) > 200;
        a.push({
          severity: critical ? 'critical' : 'warning',
          title: `${s.name?.split(' - ').pop()?.trim() || s.name} short/over`,
          description: `Register off by ${s.shortOver > 0 ? '−' : '+'}${fmt(Math.abs(s.shortOver))}`,
          href: '/cash',
        });
      }
      if (s.margin < 40 && s.revenue > 100) {
        a.push({
          severity: 'warning',
          title: `${s.name?.split(' - ').pop()?.trim() || s.name} margin low`,
          description: `Net margin only ${s.margin.toFixed(0)}% — target ≥ 40%`,
          href: '/reports',
        });
      }
    });
    const relevantStores = storeId ? stores.filter(st => st.id === storeId) : stores;
    const missingToday = relevantStores.filter(st => !todaySales.find(r => r.store_id === st.id));
    if (missingToday.length > 0) {
      a.push({
        severity: 'info',
        title: storeId ? `${missingToday[0].name?.split(' - ').pop()?.trim()} — today not entered` : `${missingToday.length} store${missingToday.length > 1 ? 's' : ''} missing today's entry`,
        description: storeId ? 'Open Daily Sales to log the entry.' : missingToday.map(s => s.name?.split(' - ').pop()?.trim()).join(', '),
        href: '/sales',
      });
    }
    if (storeId && stats && Math.abs(stats.totalShortOver) > 50) {
      const critical = Math.abs(stats.totalShortOver) > 200;
      a.push({
        severity: critical ? 'critical' : 'warning',
        title: 'Short / Over flagged',
        description: `Period total: ${stats.totalShortOver > 0 ? '−' : '+'}${fmt(Math.abs(stats.totalShortOver))}`,
        href: '/cash',
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

  const totalToday = todaySales.reduce((s, r) => s + (r.total_sales ?? r.gross_sales ?? 0), 0);
  const avgDaily = stats?.sparkNet?.length ? (stats.sparkNet.reduce((a, b) => a + b, 0) / stats.sparkNet.length) : 0;
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysPassed = now.getDate();
  const daysLeft = daysInMonth - daysPassed;
  const paceMonthly = stats && daysPassed > 0 ? (stats.netProfit / daysPassed) * daysInMonth : 0;
  const pct = (cur, prev) => (prev && prev !== 0) ? ((cur - prev) / Math.abs(prev)) * 100 : null;
  const lastSyncAgo = lastSync?.time ? (() => {
    const mins = Math.max(0, Math.round((Date.now() - new Date(lastSync.time).getTime()) / 60000));
    if (mins < 60) return `${mins}m ago`;
    if (mins < 60 * 24) return `${Math.floor(mins / 60)}h ago`;
    return `${Math.floor(mins / (60 * 24))}d ago`;
  })() : null;

  return (
    <div>
      {/* Live status bar */}
      <LiveStatusBar
        todayRevenue={totalToday}
        avgDaily={avgDaily}
        clockedIn={clockedIn}
        alertCount={alerts.length}
        lastSyncAgo={lastSyncAgo}
      />

      {/* Compact top row: NRS status + store pills */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <StorePills stores={stores} value={selectedStore} onChange={setSelectedStore} className="!mb-0" />
        <div className="flex items-center gap-2 flex-wrap">
          {isOwner && nrsStatus !== null && (
            <Badge variant={nrsStatus ? 'success' : 'danger'}>
              {nrsStatus ? '🤖 NRS Connected' : '✕ NRS Invalid'}
            </Badge>
          )}
        </div>
      </div>

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      {loadError && (
        <div className="mb-3 rounded-md border px-3 py-2 text-[12px]" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}>
          {loadError}
        </div>
      )}

      {/* Hero: Net Profit */}
      {stats && (
        <HeroNetProfit
          amount={stats.netProfit}
          rangeLabel={preset === 'thismonth' ? 'This Month' : `${range.start} to ${range.end}`}
          trendPct={prevTotals ? pct(stats.netProfit, prevTotals.profit) : null}
          margin={stats.margin}
          paceMonthly={paceMonthly}
          daysLeft={preset === 'thismonth' ? daysLeft : null}
          sparklineData={stats.sparkProfit || []}
        />
      )}

      {/* KPI grid */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-5">
          <StatCardV2
            label="Revenue"
            value={fmt(stats.totalNet)}
            valueColor="var(--text-primary)"
            sparklineColor="var(--color-success)"
            sparklineData={stats.sparkNet || []}
            trendPct={prevTotals ? pct(stats.totalNet, prevTotals.net) : null}
            trendGoodWhenPositive
          />
          <StatCardV2
            label="Product Buying"
            value={fmt(stats.totalPurch)}
            valueColor="var(--color-warning)"
            sparklineColor="var(--color-warning)"
            sparklineData={stats.sparkPurch || []}
            trendPct={prevTotals ? pct(stats.totalPurch, prevTotals.purch) : null}
            trendGoodWhenPositive={false}
          />
          <StatCardV2
            label="Expenses"
            value={fmt(stats.totalExp)}
            valueColor="var(--color-danger)"
            sparklineColor="var(--color-danger)"
            sparklineData={[]}
            trendPct={prevTotals ? pct(stats.totalExp, prevTotals.exp) : null}
            trendGoodWhenPositive={false}
          />
          <StatCardV2
            label="Tax Collected"
            value={fmt(stats.totalTax)}
            valueColor="var(--color-info)"
            sparklineColor="var(--color-info)"
            sparklineData={stats.sparkTax || []}
            trendPct={prevTotals ? pct(stats.totalTax, prevTotals.tax) : null}
            trendGoodWhenPositive
          />
        </div>
      )}

      {/* Attention Needed */}
      {alerts.length > 0 ? (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>Attention Needed</h2>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>{alerts.length}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {alerts.map((a, i) => (
              <AlertCardV2 key={i} severity={a.severity} title={a.title} description={a.description} href={a.href} />
            ))}
          </div>
        </div>
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
        {paymentMix && (() => {
          // SVG donut with a 2px gap between arcs and direct % labels.
          const r = 40, cx = 50, cy = 50;
          const circumference = 2 * Math.PI * r;
          const cardPct = Math.max(0, Math.min(1, paymentMix.card / (paymentMix.cash + paymentMix.card || 1)));
          const cashPct = 1 - cardPct;
          const gap = 2 / (2 * Math.PI * r) * 360; // gap in degrees
          const cardArc = Math.max(0, cardPct * 360 - gap);
          const cashArc = Math.max(0, cashPct * 360 - gap);
          const cardStrokeDash = `${(cardArc / 360) * circumference} ${circumference}`;
          const cashStrokeDash = `${(cashArc / 360) * circumference} ${circumference}`;
          // Labels positioned at the middle of each arc.
          const cardMidAngle = -90 + (cardArc / 2);
          const cashMidAngle = -90 + cardArc + gap + (cashArc / 2);
          const toXY = (ang) => {
            const a = (ang * Math.PI) / 180;
            return { x: cx + (r + 10) * Math.cos(a), y: cy + (r + 10) * Math.sin(a) };
          };
          const cardLabel = toXY(cardMidAngle);
          const cashLabel = toXY(cashMidAngle);
          const total = paymentMix.cash + paymentMix.card;
          return (
            <div className="rounded-[16px] border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}>
              <h3 className="text-[14px] font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Payment Mix</h3>
              <div className="flex flex-col items-center py-2">
                <div className="relative">
                  <svg width={128} height={128} viewBox="0 0 100 100">
                    <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-hover)" strokeWidth="0.5" />
                    <circle
                      cx={cx} cy={cy} r={r}
                      fill="none"
                      stroke="var(--color-info)"
                      strokeWidth="10"
                      strokeDasharray={cardStrokeDash}
                      strokeDashoffset="0"
                      transform={`rotate(-90 ${cx} ${cy})`}
                    />
                    <circle
                      cx={cx} cy={cy} r={r}
                      fill="none"
                      stroke="var(--color-success)"
                      strokeWidth="10"
                      strokeDasharray={cashStrokeDash}
                      strokeDashoffset={-((cardArc + gap) / 360) * circumference}
                      transform={`rotate(-90 ${cx} ${cy})`}
                    />
                    {cardPct > 0.08 && (
                      <text x={cardLabel.x} y={cardLabel.y} fontSize="7" textAnchor="middle" dominantBaseline="middle" fill="var(--color-info)">{(cardPct * 100).toFixed(0)}%</text>
                    )}
                    {cashPct > 0.08 && (
                      <text x={cashLabel.x} y={cashLabel.y} fontSize="7" textAnchor="middle" dominantBaseline="middle" fill="var(--color-success)">{(cashPct * 100).toFixed(0)}%</text>
                    )}
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="text-[20px] font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmt(total)}</span>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <span className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full" style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)' }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: 'var(--color-info)' }} />
                    Card {paymentMix.cardPct}%
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full" style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)' }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: 'var(--color-success)' }} />
                    Cash {paymentMix.cashPct}%
                  </span>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Store Performance */}
      {sortedStores.length > 0 && (() => {
        const maxRev = Math.max(1, ...sortedStores.map(s => s.revenue));
        const cycle = { revenue: 'profit', profit: 'margin', margin: 'revenue' };
        const label = { revenue: 'revenue', profit: 'profit', margin: 'margin' };
        return (
          <div className="mb-5 rounded-[16px] border overflow-hidden" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <h2 className="text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>Store performance</h2>
              <button
                type="button"
                onClick={() => setStoreSort(s => cycle[s] || 'revenue')}
                className="text-[12px] hover:underline"
                style={{ color: 'var(--text-muted)' }}
              >
                Sorted by {label[storeSort] || storeSort} ↻
              </button>
            </div>
            <div>
              {sortedStores.map((s, i) => (
                <StorePerformanceRow
                  key={s.id}
                  rank={i + 1}
                  name={s.name}
                  color={s.color}
                  revenue={s.revenue}
                  profit={s.profit}
                  margin={s.margin}
                  maxRevenue={maxRev}
                  isFirst={i === 0}
                  isLast={i === sortedStores.length - 1}
                  onClick={() => setSelectedStore(s.id)}
                />
              ))}
            </div>
          </div>
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
