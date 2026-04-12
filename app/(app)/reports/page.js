'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, PageHeader, StatCard, Loading, StoreBadge, Alert, Button } from '@/components/UI';
import { fmt, fK, downloadCSV, EXPENSE_CATEGORIES, previousRange } from '@/lib/utils';

export default function ReportsPage() {
  const { supabase, isOwner } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('thismonth');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [stores, setStores] = useState([]);
  const [storeRows, setStoreRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [expenseRows, setExpenseRows] = useState([]);
  const [topItems, setTopItems] = useState([]);
  const [byCategory, setByCategory] = useState([]);
  const [byVendor, setByVendor] = useState([]);
  const [dailyTrend, setDailyTrend] = useState([]);
  const [trendStats, setTrendStats] = useState(null);
  const [cashRecon, setCashRecon] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const { data: st } = await supabase.from('stores').select('*').eq('is_active', true);
        setStores(st || []);

        const prev = previousRange(range);

        // Pull everything in parallel for current and previous periods.
        const [
          { data: salesCur },
          { data: salesPrev },
          { data: purchCur },
          { data: purchPrev },
          { data: expCur },
          { data: expPrev },
          { data: cashCur },
        ] = await Promise.all([
          supabase.from('daily_sales').select('*').gte('date', range.start).lte('date', range.end),
          supabase.from('daily_sales').select('total_sales').gte('date', prev.start).lte('date', prev.end),
          supabase.from('purchases').select('*').gte('week_of', range.start).lte('week_of', range.end),
          supabase.from('purchases').select('total_cost').gte('week_of', prev.start).lte('week_of', prev.end),
          supabase.from('expenses').select('*').gte('month', range.start.slice(0, 7)).lte('month', range.end.slice(0, 7)),
          supabase.from('expenses').select('amount, category').gte('month', prev.start.slice(0, 7)).lte('month', prev.end.slice(0, 7)),
          supabase.from('cash_collections').select('*').gte('date', range.start).lte('date', range.end),
        ]);

        // ── Section 1 — Summary ─────────────────────────
        const totalRevenue = (salesCur || []).reduce((s, r) => s + (r.total_sales || 0), 0);
        const totalCash = (salesCur || []).reduce((s, r) => s + (r.cash_sales || 0), 0);
        const totalCard = (salesCur || []).reduce((s, r) => s + (r.card_sales || 0), 0);
        const totalTax = (salesCur || []).reduce((s, r) => s + (r.tax_collected || 0), 0);
        const totalPurchases = (purchCur || []).reduce((s, r) => s + (r.total_cost || 0), 0);
        const totalExpenses = (expCur || []).reduce((s, r) => s + (r.amount || 0), 0);
        const grossProfit = totalRevenue - totalPurchases;
        const netProfit = totalRevenue - totalPurchases - totalExpenses;
        const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
        const cashPct = totalRevenue > 0 ? (totalCash / totalRevenue) * 100 : 0;
        const cardPct = totalRevenue > 0 ? (totalCard / totalRevenue) * 100 : 0;

        const prevRevenue = (salesPrev || []).reduce((s, r) => s + (r.total_sales || 0), 0);
        const prevPurchases = (purchPrev || []).reduce((s, r) => s + (r.total_cost || 0), 0);
        const prevExpenses = (expPrev || []).reduce((s, r) => s + (r.amount || 0), 0);

        setSummary({
          totalRevenue, totalCash, totalCard, totalTax,
          totalPurchases, totalExpenses,
          grossProfit, netProfit, margin, cashPct, cardPct,
          revenueChange: prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : null,
        });

        // ── Section 2 — Store breakdown ─────────────────
        const rows = (st || []).map(s => {
          const rev = (salesCur || []).filter(r => r.store_id === s.id).reduce((a, r) => a + (r.total_sales || 0), 0);
          const tax = (salesCur || []).filter(r => r.store_id === s.id).reduce((a, r) => a + (r.tax_collected || 0), 0);
          const pur = (purchCur || []).filter(r => r.store_id === s.id).reduce((a, r) => a + (r.total_cost || 0), 0);
          const exp = (expCur || []).filter(r => r.store_id === s.id).reduce((a, r) => a + (r.amount || 0), 0);
          const gross = rev - pur;
          const net = rev - pur - exp;
          const mg = rev > 0 ? (net / rev) * 100 : 0;
          return { ...s, revenue: rev, purchases: pur, expenses: exp, tax, gross, net, margin: mg };
        }).sort((a, b) => b.net - a.net);
        setStoreRows(rows);

        // ── Section 3 — Expense by category ─────────────
        const byCatCur = {}, byCatPrev = {};
        (expCur || []).forEach(r => { byCatCur[r.category] = (byCatCur[r.category] || 0) + (r.amount || 0); });
        (expPrev || []).forEach(r => { byCatPrev[r.category] = (byCatPrev[r.category] || 0) + (r.amount || 0); });
        const catRows = Object.keys({ ...byCatCur, ...byCatPrev }).map(cat => {
          const meta = EXPENSE_CATEGORIES.find(c => c.id === cat);
          const cur = byCatCur[cat] || 0;
          const old = byCatPrev[cat] || 0;
          const change = old > 0 ? ((cur - old) / old) * 100 : (cur > 0 ? 100 : 0);
          return { id: cat, label: meta?.label || cat, icon: meta?.icon || '📋', current: cur, previous: old, change };
        }).sort((a, b) => b.current - a.current);
        setExpenseRows(catRows);

        // ── Section 4 — Purchase breakdown ──────────────
        const itemAgg = {};
        const catAgg = {};
        const vendAgg = {};
        (purchCur || []).forEach(r => {
          itemAgg[r.item] = (itemAgg[r.item] || 0) + (r.total_cost || 0);
          if (r.category) catAgg[r.category] = (catAgg[r.category] || 0) + (r.total_cost || 0);
          if (r.supplier) vendAgg[r.supplier] = (vendAgg[r.supplier] || 0) + (r.total_cost || 0);
        });
        setTopItems(Object.entries(itemAgg).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 10));
        setByCategory(Object.entries(catAgg).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total));
        setByVendor(Object.entries(vendAgg).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total));

        // ── Section 5 — Daily trend ─────────────────────
        const byDay = {};
        (salesCur || []).forEach(r => {
          byDay[r.date] = byDay[r.date] || { date: r.date, total: 0, cash: 0, card: 0 };
          byDay[r.date].total += (r.total_sales || 0);
          byDay[r.date].cash += (r.cash_sales || 0);
          byDay[r.date].card += (r.card_sales || 0);
        });
        const days = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
        setDailyTrend(days);
        if (days.length) {
          const best = days.reduce((a, b) => b.total > a.total ? b : a);
          const worst = days.reduce((a, b) => b.total < a.total ? b : a);
          const avg = days.reduce((s, d) => s + d.total, 0) / days.length;
          setTrendStats({ best, worst, avg, dayCount: days.length });
        } else {
          setTrendStats(null);
        }

        // ── Section 6 — Cash reconciliation ─────────────
        const cashByKey = {};
        (salesCur || []).forEach(r => {
          const k = `${r.store_id}|${r.date}`;
          cashByKey[k] = { expected: (cashByKey[k]?.expected || 0) + (r.cash_sales || 0), collected: cashByKey[k]?.collected || 0 };
        });
        (cashCur || []).forEach(r => {
          const k = `${r.store_id}|${r.date}`;
          cashByKey[k] = { expected: cashByKey[k]?.expected || 0, collected: (cashByKey[k]?.collected || 0) + (r.cash_collected || 0) };
        });
        let expectedTotal = 0, collectedTotal = 0, shortDays = 0, overDays = 0, pendingDays = 0;
        Object.values(cashByKey).forEach(v => {
          expectedTotal += v.expected;
          collectedTotal += v.collected;
          if (v.collected === 0 && v.expected > 0) pendingDays += 1;
          else if (v.collected < v.expected - 0.01) shortDays += 1;
          else if (v.collected > v.expected + 0.01) overDays += 1;
        });
        setCashRecon({
          expected: expectedTotal,
          collected: collectedTotal,
          diff: collectedTotal - expectedTotal,
          shortDays, overDays, pendingDays,
        });
      } catch (e) {
        console.error('[reports] load failed:', e);
        setLoadError(e?.message || 'Failed to load report');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [range.start, range.end]);

  const handleExportCSV = () => {
    if (!summary) return;
    const rows = [
      ['P&L Report', `${range.start} to ${range.end}`],
      [],
      ['SUMMARY'],
      ['Total Revenue', summary.totalRevenue.toFixed(2)],
      ['Total Purchases', summary.totalPurchases.toFixed(2)],
      ['Total Expenses', summary.totalExpenses.toFixed(2)],
      ['Gross Profit', summary.grossProfit.toFixed(2)],
      ['Net Profit', summary.netProfit.toFixed(2)],
      ['Profit Margin %', summary.margin.toFixed(2)],
      ['Tax Collected', summary.totalTax.toFixed(2)],
      ['Cash %', summary.cashPct.toFixed(2)],
      ['Card %', summary.cardPct.toFixed(2)],
      [],
      ['STORE BREAKDOWN'],
      ['Store', 'Revenue', 'Purchases', 'Expenses', 'Gross', 'Net', 'Margin%', 'Tax'],
      ...storeRows.map(s => [s.name, s.revenue, s.purchases, s.expenses, s.gross, s.net, s.margin.toFixed(2), s.tax]),
      [],
      ['EXPENSE BY CATEGORY'],
      ['Category', 'Current', 'Previous', 'Change %'],
      ...expenseRows.map(r => [r.label, r.current, r.previous, r.change.toFixed(2)]),
    ];
    downloadCSV(`pnl_${range.start}_${range.end}.csv`, rows[0], rows.slice(1));
  };

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  const totals = storeRows.reduce((a, s) => ({
    revenue: a.revenue + s.revenue,
    purchases: a.purchases + s.purchases,
    expenses: a.expenses + s.expenses,
    tax: a.tax + s.tax,
    gross: a.gross + s.gross,
    net: a.net + s.net,
  }), { revenue: 0, purchases: 0, expenses: 0, tax: 0, gross: 0, net: 0 });

  const maxCatCurrent = Math.max(1, ...expenseRows.map(r => r.current));
  const maxTrendDay = Math.max(1, ...dailyTrend.map(d => d.total));

  return (
    <div className="print:bg-white print:text-black">
      <PageHeader title="📑 P&L Report" subtitle={`${range.start} to ${range.end}`}>
        <Button variant="secondary" onClick={handleExportCSV} className="!text-[11px]">📥 CSV</Button>
        <Button variant="secondary" onClick={() => typeof window !== 'undefined' && window.print()} className="!text-[11px]">🖨️ Print</Button>
      </PageHeader>

      {loadError && <Alert type="error">{loadError}</Alert>}

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      {/* ── Section 1 — Summary ─────────────────────── */}
      {summary && (
        <div className="mb-4">
          <h2 className="text-sw-sub text-[10px] font-bold uppercase tracking-wider mb-2">Summary</h2>
          <div className="flex gap-2.5 flex-wrap">
            <StatCard label="Total Revenue" value={fK(summary.totalRevenue)} icon="💰" color="#34D399"
              sub={summary.revenueChange != null ? `${summary.revenueChange >= 0 ? '▲' : '▼'} ${Math.abs(summary.revenueChange).toFixed(1)}% vs prev` : 'no prior data'} />
            <StatCard label="Purchases (COGS)" value={fK(summary.totalPurchases)} icon="🛒" color="#FBBF24" />
            <StatCard label="Operating Expenses" value={fK(summary.totalExpenses)} icon="📋" color="#F87171" />
            <StatCard label="Gross Profit" value={fK(summary.grossProfit)} icon="📈" color={summary.grossProfit >= 0 ? '#34D399' : '#F87171'} />
            <StatCard label="Net Profit" value={fK(summary.netProfit)} icon={summary.netProfit >= 0 ? '✅' : '⚠️'} color={summary.netProfit >= 0 ? '#34D399' : '#F87171'} />
            <StatCard label="Profit Margin" value={`${summary.margin.toFixed(1)}%`} icon="📊" color={summary.margin >= 20 ? '#34D399' : summary.margin >= 0 ? '#FBBF24' : '#F87171'} />
            <StatCard label="Tax Collected" value={fK(summary.totalTax)} icon="🏛️" color="#22D3EE" />
            <StatCard label="Cash / Card Mix" value={`${summary.cashPct.toFixed(0)}% / ${summary.cardPct.toFixed(0)}%`} icon="💳" color="#93C5FD" />
          </div>
        </div>
      )}

      {/* ── Section 2 — Store breakdown ─────────────── */}
      <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden mb-4">
        <div className="px-3 py-2 border-b border-sw-border">
          <h3 className="text-sw-text text-xs font-bold">Store-by-Store Breakdown</h3>
        </div>
        <DataTable
          emptyMessage="No sales in this period yet."
          columns={[
            { key: 'name', label: 'Store', render: (v, r) => <StoreBadge name={v} color={r.color} /> },
            { key: 'revenue', label: 'Revenue', align: 'right', mono: true, render: v => <span className="text-sw-green">{fmt(v)}</span> },
            { key: 'purchases', label: 'Purchases', align: 'right', mono: true, render: v => fmt(v) },
            { key: 'expenses', label: 'Expenses', align: 'right', mono: true, render: v => fmt(v) },
            { key: 'gross', label: 'Gross', align: 'right', mono: true, render: v => <span className={v >= 0 ? 'text-sw-green' : 'text-sw-red'}>{fmt(v)}</span> },
            { key: 'net', label: 'Net Profit', align: 'right', mono: true, render: v => <span className={v >= 0 ? 'text-sw-green font-bold' : 'text-sw-red font-bold'}>{fmt(v)}</span> },
            { key: 'margin', label: 'Margin', align: 'right', mono: true, render: v => <span className={v >= 20 ? 'text-sw-green' : v >= 0 ? 'text-sw-amber' : 'text-sw-red'}>{v.toFixed(1)}%</span> },
            { key: 'tax', label: 'Tax', align: 'right', mono: true, render: v => <span className="text-sw-cyan">{fmt(v)}</span> },
          ]}
          rows={storeRows}
          isOwner={false}
        />
        {storeRows.length > 0 && (
          <div className="px-3 py-2 border-t border-sw-border bg-sw-card2 text-[12px] font-mono flex flex-wrap gap-x-5 gap-y-1">
            <span className="text-sw-sub">TOTALS</span>
            <span>Rev <span className="text-sw-green font-bold">{fmt(totals.revenue)}</span></span>
            <span>Purch {fmt(totals.purchases)}</span>
            <span>Exp {fmt(totals.expenses)}</span>
            <span>Net <span className={totals.net >= 0 ? 'text-sw-green font-bold' : 'text-sw-red font-bold'}>{fmt(totals.net)}</span></span>
          </div>
        )}
      </div>

      {/* ── Section 3 — Expenses by category ───────────── */}
      <div className="bg-sw-card rounded-xl border border-sw-border p-4 mb-4">
        <h3 className="text-sw-text text-xs font-bold mb-3">Expense Breakdown</h3>
        {expenseRows.length === 0 ? (
          <div className="text-sw-dim text-xs text-center py-6">No expenses in this period.</div>
        ) : (
          <>
            <div className="space-y-1.5 mb-4">
              {expenseRows.map(r => (
                <div key={r.id} className="flex items-center gap-2">
                  <div className="w-32 flex items-center gap-1 text-sw-sub text-[11px] flex-shrink-0">
                    <span>{r.icon}</span><span className="truncate">{r.label}</span>
                  </div>
                  <div className="flex-1 bg-sw-card2 rounded h-4 relative overflow-hidden">
                    <div className="h-full bg-sw-red/40" style={{ width: `${(r.current / maxCatCurrent) * 100}%` }} />
                  </div>
                  <span className="w-20 text-right text-sw-text font-mono text-[11px]">{fmt(r.current)}</span>
                </div>
              ))}
            </div>
            <table>
              <thead>
                <tr><th>Category</th><th style={{ textAlign: 'right' }}>This Period</th><th style={{ textAlign: 'right' }}>Previous</th><th style={{ textAlign: 'right' }}>Change</th></tr>
              </thead>
              <tbody>
                {expenseRows.map(r => (
                  <tr key={r.id}>
                    <td>{r.icon} {r.label}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono' }}>{fmt(r.current)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono' }} className="!text-sw-sub">{fmt(r.previous)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono' }}>
                      {r.previous > 0 ? (
                        <span className={r.change > 0 ? 'text-sw-red' : 'text-sw-green'}>
                          {r.change > 0 ? '▲' : '▼'} {Math.abs(r.change).toFixed(1)}%
                        </span>
                      ) : <span className="text-sw-dim">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* ── Section 4 — Purchases breakdown ─────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="bg-sw-card rounded-xl border border-sw-border p-4">
          <h3 className="text-sw-text text-xs font-bold mb-2">Top Items (by cost)</h3>
          {topItems.length === 0 ? <p className="text-sw-dim text-xs">No purchases.</p> : (
            <ul className="space-y-1">
              {topItems.map((r, i) => (
                <li key={i} className="flex justify-between text-[12px]">
                  <span className="text-sw-text truncate mr-2">{i + 1}. {r.name}</span>
                  <span className="text-sw-amber font-mono">{fmt(r.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-sw-card rounded-xl border border-sw-border p-4">
          <h3 className="text-sw-text text-xs font-bold mb-2">By Category</h3>
          {byCategory.length === 0 ? <p className="text-sw-dim text-xs">No data.</p> : (
            <ul className="space-y-1">
              {byCategory.map((r, i) => (
                <li key={i} className="flex justify-between text-[12px]">
                  <span className="text-sw-text truncate mr-2">{r.name}</span>
                  <span className="text-sw-amber font-mono">{fmt(r.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-sw-card rounded-xl border border-sw-border p-4">
          <h3 className="text-sw-text text-xs font-bold mb-2">By Vendor</h3>
          {byVendor.length === 0 ? <p className="text-sw-dim text-xs">No data.</p> : (
            <ul className="space-y-1">
              {byVendor.map((r, i) => (
                <li key={i} className="flex justify-between text-[12px]">
                  <span className="text-sw-text truncate mr-2">{r.name}</span>
                  <span className="text-sw-amber font-mono">{fmt(r.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Section 5 — Daily trend ─────────────────── */}
      <div className="bg-sw-card rounded-xl border border-sw-border p-4 mb-4">
        <h3 className="text-sw-text text-xs font-bold mb-2">Sales Trend</h3>
        {trendStats ? (
          <>
            <div className="flex flex-wrap gap-4 text-[11px] mb-3">
              <span>Best day: <span className="text-sw-green font-mono font-bold">{fmt(trendStats.best.total)}</span> <span className="text-sw-sub">({trendStats.best.date})</span></span>
              <span>Worst day: <span className="text-sw-red font-mono font-bold">{fmt(trendStats.worst.total)}</span> <span className="text-sw-sub">({trendStats.worst.date})</span></span>
              <span>Daily avg: <span className="text-sw-text font-mono font-bold">{fmt(trendStats.avg)}</span></span>
              <span className="text-sw-sub">{trendStats.dayCount} days tracked</span>
            </div>
            <div className="overflow-x-auto">
              <div className="flex items-end gap-0.5 h-[120px]" style={{ minWidth: dailyTrend.length * 14 }}>
                {dailyTrend.map(d => (
                  <div key={d.date} className="flex flex-col items-center justify-end flex-shrink-0" style={{ width: 12 }}>
                    <div style={{ height: `${(d.total / maxTrendDay) * 100}%`, width: 10, background: '#34D39988', borderRadius: '2px 2px 0 0' }}
                      title={`${d.date}: ${fmt(d.total)}`} />
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : <p className="text-sw-dim text-xs text-center py-4">No sales in this period.</p>}
      </div>

      {/* ── Section 6 — Cash reconciliation ─────────────── */}
      {cashRecon && (
        <div className="bg-sw-card rounded-xl border border-sw-border p-4 mb-4">
          <h3 className="text-sw-text text-xs font-bold mb-2">Cash Reconciliation</h3>
          <div className="flex flex-wrap gap-4 text-[12px]">
            <span>Expected: <span className="font-mono font-bold">{fmt(cashRecon.expected)}</span></span>
            <span>Collected: <span className="font-mono font-bold">{fmt(cashRecon.collected)}</span></span>
            <span>
              Net: <span className={`font-mono font-bold ${cashRecon.diff >= 0 ? 'text-sw-green' : 'text-sw-red'}`}>
                {cashRecon.diff >= 0 ? '+' : ''}{fmt(cashRecon.diff)}
              </span>
            </span>
            <span>Short days: <span className="text-sw-red font-bold">{cashRecon.shortDays}</span></span>
            <span>Over days: <span className="text-sw-green font-bold">{cashRecon.overDays}</span></span>
            <span>Pending: <span className="text-sw-amber font-bold">{cashRecon.pendingDays}</span></span>
          </div>
        </div>
      )}
    </div>
  );
}
