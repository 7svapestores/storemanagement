'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { generatePDF } from './generatePDF';
import { DateBar, useDateRange, Loading, StorePills } from '@/components/UI';
import { Card, V2StatCard, Badge, V2Alert, SectionHeader } from '@/components/ui';
import { fmt, downloadCSV, EXPENSE_CATEGORIES, FIXED_EXPENSE_IDS, previousRange } from '@/lib/utils';
import { generateStyledPLReport } from './generateStyledExcel';

export default function ReportsPage() {
  const { supabase, isOwner, effectiveStoreId } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('thismonth');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [stores, setStores] = useState([]);
  const [storeRows, setStoreRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [expenseRows, setExpenseRows] = useState([]);
  const [byVendor, setByVendor] = useState([]);
  const [dailyTrend, setDailyTrend] = useState([]);
  const [trendStats, setTrendStats] = useState(null);
  const [cashRecon, setCashRecon] = useState(null);
  // Raw rows captured in state so the Excel/CSV export can emit detail sheets.
  const [rawSales, setRawSales] = useState([]);
  const [rawPurch, setRawPurch] = useState([]);
  const [rawExp, setRawExp] = useState([]);
  const [rawCash, setRawCash] = useState([]);
  // Previous-period aggregates for side-by-side comparisons.
  const [byVendorPrev, setByVendorPrev] = useState([]);
  const [byItem, setByItem] = useState([]);
  const [byItemPrev, setByItemPrev] = useState([]);
  // Export scope: 'all' to export every store in the loaded range, or a
  // specific store id to export just that store. Overrides the sidebar
  // filter for CSV/Excel/PDF only — does not re-query data.
  const [exportScope, setExportScope] = useState('all');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const { data: st } = await supabase.from('stores').select('*').eq('is_active', true);
        setStores(st || []);

        const prev = previousRange(range);

        // Pull everything in parallel for current and previous periods.
        // exportScope (top-right dropdown) overrides effectiveStoreId (sidebar)
        // when set, so picking a store in the P&L header scopes both the on-
        // screen view and the downloads.
        const filterStoreId = (exportScope && exportScope !== 'all') ? exportScope : effectiveStoreId;
        const scope = (q) => filterStoreId ? q.eq('store_id', filterStoreId) : q;
        const [
          { data: salesCur },
          { data: salesPrev },
          { data: purchCur },
          { data: purchPrev },
          { data: expCur },
          { data: expPrev },
          { data: cashCur },
        ] = await Promise.all([
          scope(supabase.from('daily_sales').select('*').gte('date', range.start).lte('date', range.end)),
          scope(supabase.from('daily_sales').select('total_sales').gte('date', prev.start).lte('date', prev.end)),
          scope(supabase.from('purchases').select('*').gte('week_of', range.start).lte('week_of', range.end)),
          scope(supabase.from('purchases').select('total_cost, unit_cost, supplier, item').gte('week_of', prev.start).lte('week_of', prev.end)),
          scope(supabase.from('expenses').select('*').gte('month', range.start.slice(0, 7)).lte('month', range.end.slice(0, 7))),
          scope(supabase.from('expenses').select('amount, category').gte('month', prev.start.slice(0, 7)).lte('month', prev.end.slice(0, 7))),
          scope(supabase.from('cash_collections').select('*').gte('date', range.start).lte('date', range.end)),
        ]);

        setRawSales(salesCur || []);
        setRawPurch(purchCur || []);
        setRawExp(expCur || []);
        setRawCash(cashCur || []);
        console.log('[P&L] data loaded:', {
          sales: (salesCur||[]).length, purchases: (purchCur||[]).length, expenses: (expCur||[]).length,
          samplePurch: purchCur?.[0] ? { total_cost: purchCur[0].total_cost, unit_cost: purchCur[0].unit_cost } : 'none',
          sampleExp: expCur?.[0] ? { amount: expCur[0].amount, month: expCur[0].month } : 'none',
        });

        // ── Section 1 — Summary ─────────────────────────
        const totalGross = (salesCur || []).reduce((s, r) => s + (r.gross_sales ?? r.total_sales ?? 0), 0);
        const totalRevenue = (salesCur || []).reduce((s, r) => s + (r.total_sales || 0), 0);
        const totalCash = (salesCur || []).reduce((s, r) => s + (r.cash_sales || 0), 0);
        const totalCard = (salesCur || []).reduce((s, r) => s + (r.card_sales || 0), 0);
        const totalCheck = (salesCur || []).reduce((s, r) => s + (r.cashapp_check || 0), 0);
        const totalTax = (salesCur || []).reduce((s, r) => s + (r.tax_collected || 0), 0);
        const totalPurchases = (purchCur || []).reduce((s, r) => s + (r.total_cost || r.unit_cost || 0), 0);
        const totalExpenses = (expCur || []).reduce((s, r) => s + (r.amount || 0), 0);
        const grossProfit = totalRevenue - totalPurchases;
        const netProfit = totalRevenue - totalPurchases - totalExpenses;
        const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
        const cashPct = totalRevenue > 0 ? (totalCash / totalRevenue) * 100 : 0;
        const cardPct = totalRevenue > 0 ? (totalCard / totalRevenue) * 100 : 0;
        const checkPct = totalRevenue > 0 ? (totalCheck / totalRevenue) * 100 : 0;

        const prevRevenue = (salesPrev || []).reduce((s, r) => s + (r.total_sales || 0), 0);
        const prevPurchases = (purchPrev || []).reduce((s, r) => s + (r.total_cost || r.unit_cost || 0), 0);
        const prevExpenses = (expPrev || []).reduce((s, r) => s + (r.amount || 0), 0);

        setSummary({
          totalGross, totalRevenue, totalCash, totalCard, totalCheck, totalTax,
          totalPurchases, totalExpenses,
          grossProfit, netProfit, margin, cashPct, cardPct, checkPct,
          revenueChange: prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : null,
        });

        // ── Section 2 — Store breakdown ─────────────────
        // When a single store is scoped, only build a row for that store —
        // otherwise the Stores table renders empty rows for everyone else.
        const storesInScope = filterStoreId ? (st || []).filter(s => s.id === filterStoreId) : (st || []);
        const rows = storesInScope.map(s => {
          const storeSales = (salesCur || []).filter(r => r.store_id === s.id);
          const rev = storeSales.reduce((a, r) => a + (r.total_sales || 0), 0);
          const cash = storeSales.reduce((a, r) => a + (r.cash_sales || 0), 0);
          const card = storeSales.reduce((a, r) => a + (r.card_sales || 0), 0);
          const check = storeSales.reduce((a, r) => a + (r.cashapp_check || 0), 0);
          const tax = storeSales.reduce((a, r) => a + (r.tax_collected || 0), 0);
          const pur = (purchCur || []).filter(r => r.store_id === s.id).reduce((a, r) => a + (r.total_cost || r.unit_cost || 0), 0);
          const exp = (expCur || []).filter(r => r.store_id === s.id).reduce((a, r) => a + (r.amount || 0), 0);
          const gross = rev - pur;
          const net = rev - pur - exp;
          const mg = rev > 0 ? (net / rev) * 100 : 0;
          return { ...s, revenue: rev, cash, card, check, purchases: pur, expenses: exp, tax, gross, net, margin: mg };
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

        // ── Section 4 — Vendor breakdown (current + previous) ──────
        const aggBy = (rows, key) => {
          const out = {};
          (rows || []).forEach(r => {
            const k = r[key];
            if (!k) return;
            out[k] = (out[k] || 0) + (r.total_cost || r.unit_cost || 0);
          });
          return out;
        };
        const vendAggCur  = aggBy(purchCur, 'supplier');
        const vendAggPrev = aggBy(purchPrev, 'supplier');
        const itemAggCur  = aggBy(purchCur, 'item');
        const itemAggPrev = aggBy(purchPrev, 'item');
        setByVendor(Object.entries(vendAggCur).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total));
        setByVendorPrev(Object.entries(vendAggPrev).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total));
        setByItem(Object.entries(itemAggCur).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total));
        setByItemPrev(Object.entries(itemAggPrev).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total));

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
  }, [range.start, range.end, effectiveStoreId, exportScope]);

  // Data is already scoped at load time by exportScope (or effectiveStoreId).
  // Bundle just returns the current state + a display name for filenames.
  const buildExportBundle = () => {
    const activeStoreId = (exportScope && exportScope !== 'all') ? exportScope : effectiveStoreId;
    const scopeName = activeStoreId
      ? (stores.find(s => s.id === activeStoreId)?.name || 'Store')
      : 'All Stores';
    return { summary, storeRows, rawSales, rawPurch, rawExp, rawCash, scopeName };
  };

  // Build a single "Full Report" sheet — same shape for both Excel sheet 1 and CSV.
  const buildFullReportRows = (bundle) => {
    const { summary, storeRows, rawSales, rawPurch, rawExp, rawCash, scopeName } =
      bundle || buildExportBundle();
    if (!summary) return [];
    const selectedName = scopeName;
    const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pct = (n) => `${Number(n || 0).toFixed(2)}%`;

    const rows = [];
    rows.push(['7S STORES - PROFIT & LOSS REPORT']);
    rows.push([`Period: ${range.start} to ${range.end}`]);
    rows.push([`Generated: ${new Date().toISOString().split('T')[0]}`]);
    rows.push([`Store: ${selectedName}`]);
    rows.push([]);

    // ── Revenue Summary
    rows.push(['=== REVENUE SUMMARY ===']);
    rows.push(['Metric', 'Amount']);
    rows.push(['Total Revenue', money(summary.totalRevenue)]);
    rows.push(['Total Cash Sales', money(summary.totalCash)]);
    rows.push(['Total Card Sales', money(summary.totalCard)]);
    rows.push(['Total CashApp / Check', money(summary.totalCheck || 0)]);
    rows.push(['Cash %', pct(summary.cashPct)]);
    rows.push(['Card %', pct(summary.cardPct)]);
    rows.push(['CashApp / Check %', pct(summary.checkPct || 0)]);
    rows.push(['Tax Collected', money(summary.totalTax)]);
    rows.push([]);

    // ── Cost Summary
    rows.push(['=== COST SUMMARY ===']);
    rows.push(['Total Purchases (Product Buying)', money(summary.totalPurchases)]);
    rows.push(['Total Expenses (Operating)', money(summary.totalExpenses)]);
    rows.push(['Total Costs', money(summary.totalPurchases + summary.totalExpenses)]);
    rows.push([]);

    // ── Profit Calculation
    rows.push(['=== PROFIT CALCULATION ===']);
    rows.push(['Gross Profit (Revenue - Purchases)', money(summary.grossProfit)]);
    rows.push(['Net Profit (Revenue - Purchases - Expenses)', money(summary.netProfit)]);
    const grossMargin = summary.totalRevenue > 0 ? (summary.grossProfit / summary.totalRevenue) * 100 : 0;
    rows.push(['Gross Margin %', pct(grossMargin)]);
    rows.push(['Net Margin %', pct(summary.margin)]);
    rows.push([]);

    // ── Store-by-store
    rows.push(['=== STORE-BY-STORE PERFORMANCE ===']);
    rows.push(['Store', 'Revenue', 'Cash', 'Card', 'CashApp/Check', 'Purchases', 'Expenses', 'Gross Profit', 'Net Profit', 'Net Margin %', 'Tax']);
    const storeTotals = { revenue: 0, cash: 0, card: 0, check: 0, purchases: 0, expenses: 0, gross: 0, net: 0, tax: 0 };
    storeRows.forEach(s => {
      rows.push([
        s.name,
        money(s.revenue),
        money(s.cash || 0),
        money(s.card || 0),
        money(s.check || 0),
        money(s.purchases),
        money(s.expenses),
        money(s.gross),
        money(s.net),
        pct(s.margin),
        money(s.tax),
      ]);
      storeTotals.revenue += s.revenue;
      storeTotals.cash += (s.cash || 0);
      storeTotals.card += (s.card || 0);
      storeTotals.check += (s.check || 0);
      storeTotals.purchases += s.purchases;
      storeTotals.expenses += s.expenses;
      storeTotals.gross += s.gross;
      storeTotals.net += s.net;
      storeTotals.tax += s.tax;
    });
    const totalMargin = storeTotals.revenue > 0 ? (storeTotals.net / storeTotals.revenue) * 100 : 0;
    rows.push([
      'TOTAL',
      money(storeTotals.revenue),
      money(storeTotals.cash),
      money(storeTotals.card),
      money(storeTotals.check),
      money(storeTotals.purchases),
      money(storeTotals.expenses),
      money(storeTotals.gross),
      money(storeTotals.net),
      pct(totalMargin),
      money(storeTotals.tax),
    ]);
    rows.push([]);

    // ── Expenses by category × store matrix
    rows.push(['=== EXPENSES BY CATEGORY ===']);
    const storeHeader = ['Category', ...storeRows.map(s => s.name), 'TOTAL'];
    rows.push(storeHeader);
    // Collect all category keys — fixed ones in order, then any custom ones present.
    const seenCustom = new Set();
    rawExp.forEach(r => { if (!FIXED_EXPENSE_IDS.has(r.category)) seenCustom.add(r.category); });
    const allCategories = [
      ...EXPENSE_CATEGORIES.map(c => ({ id: c.id, label: `${c.icon} ${c.label}` })),
      ...[...seenCustom].sort().map(id => ({ id, label: `✨ ${id}` })),
    ];
    const colTotals = new Array(storeRows.length).fill(0);
    let grandExpTotal = 0;
    allCategories.forEach(cat => {
      const row = [cat.label];
      let rowTotal = 0;
      storeRows.forEach((s, i) => {
        const amt = rawExp
          .filter(r => r.store_id === s.id && r.category === cat.id)
          .reduce((sum, r) => sum + (r.amount || 0), 0);
        row.push(money(amt));
        colTotals[i] += amt;
        rowTotal += amt;
      });
      row.push(money(rowTotal));
      grandExpTotal += rowTotal;
      rows.push(row);
    });
    rows.push(['TOTAL', ...colTotals.map(money), money(grandExpTotal)]);
    rows.push([]);

    // ── Product buying by vendor
    rows.push(['=== PRODUCT BUYING BY VENDOR ===']);
    rows.push(['Vendor', 'Total Amount', '% of Total']);
    const byVendMap = {};
    rawPurch.forEach(p => {
      const key = p.supplier || 'Unknown';
      byVendMap[key] = (byVendMap[key] || 0) + (p.total_cost || 0);
    });
    const purchTotal = summary.totalPurchases;
    const vendorEntries = Object.entries(byVendMap).sort((a, b) => b[1] - a[1]);
    vendorEntries.forEach(([name, total]) => {
      const share = purchTotal > 0 ? (total / purchTotal) * 100 : 0;
      rows.push([name, money(total), pct(share)]);
    });
    rows.push(['TOTAL', money(purchTotal), pct(100)]);
    rows.push([]);

    // ── Cash reconciliation
    rows.push(['=== CASH RECONCILIATION ===']);
    rows.push(['Store', 'Cash Sales (Expected)', 'Cash Collected', 'Short/Over', 'Status']);
    let reconExp = 0, reconCol = 0;
    storeRows.forEach(s => {
      const expected = rawSales.filter(r => r.store_id === s.id).reduce((sum, r) => sum + (r.cash_sales || 0), 0);
      const collected = rawCash.filter(r => r.store_id === s.id).reduce((sum, r) => sum + (r.cash_collected || 0), 0);
      const diff = collected - expected;
      let status = 'pending';
      if (collected > 0) {
        if (Math.abs(diff) < 0.01) status = 'matched';
        else if (diff > 0) status = 'over';
        else status = 'short';
      }
      rows.push([s.name, money(expected), money(collected), money(diff), status]);
      reconExp += expected;
      reconCol += collected;
    });
    rows.push(['TOTAL', money(reconExp), money(reconCol), money(reconCol - reconExp), '']);
    rows.push([]);

    // ── Top purchased items
    rows.push(['=== TOP PURCHASED ITEMS ===']);
    rows.push(['Item Name', 'Vendor', 'Quantity', 'Unit Cost', 'Total Cost', 'Store']);
    const sortedItems = [...rawPurch].sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0)).slice(0, 20);
    sortedItems.forEach(p => {
      const storeName = stores.find(s => s.id === p.store_id)?.name || '';
      rows.push([
        p.item,
        p.supplier || '',
        p.quantity || 0,
        money(p.unit_cost || 0),
        money(p.total_cost || 0),
        storeName,
      ]);
    });

    return rows;
  };

  const monthYearTag = () => {
    const d = new Date();
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' }).replace(' ', '');
  };

  const fileTag = (scopeName) => {
    const storeName = scopeName
      || (effectiveStoreId ? (stores.find(s => s.id === effectiveStoreId)?.name || 'Store') : 'AllStores');
    const safe = storeName.replace(/[^a-z0-9]+/gi, '').slice(0, 20) || 'Store';
    return `7S-${safe}-Report-${monthYearTag()}`;
  };

  const handleExportCSV = () => {
    const bundle = buildExportBundle();
    const rows = buildFullReportRows(bundle);
    if (!rows.length) return;
    downloadCSV(`${fileTag(bundle.scopeName)}.csv`, rows[0], rows.slice(1));
  };

  const handleExportExcel = async () => {
    try {
      const bundle = {
        ...buildExportBundle(),
        expenseCategories: EXPENSE_CATEGORIES,
        fixedExpenseIds: FIXED_EXPENSE_IDS,
        stores,
      };
      const buffer = await generateStyledPLReport(bundle, range);
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileTag(bundle.scopeName)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[reports] Excel export failed:', e);
      alert('Excel export failed: ' + (e?.message || 'unknown'));
    }
  };

  if (!isOwner) return <div className="text-[var(--text-muted)] text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  const totals = storeRows.reduce((a, s) => ({
    revenue: a.revenue + s.revenue,
    purchases: a.purchases + s.purchases,
    expenses: a.expenses + s.expenses,
    tax: a.tax + s.tax,
    gross: a.gross + s.gross,
    net: a.net + s.net,
  }), { revenue: 0, purchases: 0, expenses: 0, tax: 0, gross: 0, net: 0 });

  const soColor = (v) => Math.abs(v) < 0.01 ? 'var(--text-muted)' : v >= 0 ? 'var(--color-success)' : 'var(--color-danger)';

  const maxTrendDay = Math.max(1, ...dailyTrend.map(d => d.total));

  // ── Auto-generated insights ──
  const insights = [];
  if (summary) {
    if (summary.revenueChange != null) {
      if (summary.revenueChange >= 5) insights.push({ type: 'good', text: `Revenue up ${summary.revenueChange.toFixed(1)}% vs previous period — strong growth` });
      else if (summary.revenueChange <= -5) insights.push({ type: 'bad', text: `Revenue down ${Math.abs(summary.revenueChange).toFixed(1)}% vs previous period — investigate` });
      else insights.push({ type: 'info', text: `Revenue roughly flat (${summary.revenueChange >= 0 ? '+' : ''}${summary.revenueChange.toFixed(1)}%) vs previous period` });
    }
    if (storeRows.length > 1) {
      const top = storeRows[0];
      if (top) insights.push({ type: 'good', text: `${top.name} is the top performer with ${top.margin.toFixed(1)}% profit margin` });
      const bottom = storeRows[storeRows.length - 1];
      if (bottom && bottom.margin < 10) insights.push({ type: 'warn', text: `${bottom.name} has only ${bottom.margin.toFixed(1)}% margin — needs attention` });
    }
    const expRatio = summary.totalRevenue > 0 ? (summary.totalExpenses / summary.totalRevenue) * 100 : 0;
    if (expRatio > 35) insights.push({ type: 'warn', text: `Operating expenses at ${expRatio.toFixed(0)}% of revenue (target: <30%)` });
    if (summary.netProfit > 0 && trendStats?.dayCount) {
      const dailyProfit = summary.netProfit / trendStats.dayCount;
      insights.push({ type: 'info', text: `On track for ~${fmt(dailyProfit * 30)}/month net profit` });
    }
    expenseRows.forEach(r => {
      if (r.previous > 100 && r.change > 30) insights.push({ type: 'warn', text: `${r.label} expenses up ${r.change.toFixed(0)}% vs previous period` });
    });
  }

  // ── Watchouts ──
  const watchouts = [];
  if (cashRecon) {
    if (Math.abs(cashRecon.diff) > 50) watchouts.push({ sev: 'red', text: `Cash reconciliation off by ${fmt(Math.abs(cashRecon.diff))}`, link: '/cash' });
    if (cashRecon.pendingDays > 3) watchouts.push({ sev: 'yellow', text: `${cashRecon.pendingDays} days pending cash collection`, link: '/cash' });
  }
  storeRows.forEach(s => {
    if (s.margin < 20 && s.revenue > 100) watchouts.push({ sev: 'yellow', text: `${s.name}: profit margin only ${s.margin.toFixed(1)}%`, link: '/reports' });
  });

  const handlePDF = () => {
    try {
      const bundle = buildExportBundle();
      const pdf = generatePDF({
        summary: bundle.summary,
        storeRows: bundle.storeRows,
        expenseRows,
        byVendor,
        dailyTrend,
        trendStats,
        cashRecon,
        insights,
        watchouts,
        rawSales: bundle.rawSales,
        rawPurch: bundle.rawPurch,
        rawExp: bundle.rawExp,
        stores,
        scopeName: bundle.scopeName,
      }, range);
      pdf.save(`${fileTag(bundle.scopeName)}.pdf`);
    } catch (e) { console.error('PDF generation failed:', e); alert('PDF generation failed: ' + e.message); }
  };

  return (
    <div className="print:bg-white print:text-black">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <p className="text-[var(--text-muted)] text-[11px] font-semibold uppercase tracking-wider">Reports / P&L</p>
          <h1 className="text-[var(--text-primary)] text-[22px] font-bold tracking-tight">Business Performance Report</h1>
          <p className="text-[var(--text-secondary)] text-[12px]">{range.start} to {range.end} · {storeRows.length} {storeRows.length === 1 ? 'store' : 'stores'}</p>
        </div>
        <div className="flex gap-1.5 flex-wrap items-center print:hidden">
          <button onClick={handlePDF} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white" style={{ background: 'var(--brand-primary)' }}>Export PDF</button>
          <button onClick={handleExportExcel} className="px-3 py-1.5 rounded-lg bg-[var(--bg-hover)] border border-[var(--border-default)] text-[var(--text-secondary)] text-[11px] font-semibold">Excel</button>
          <button onClick={handleExportCSV} className="px-3 py-1.5 rounded-lg bg-[var(--bg-hover)] border border-[var(--border-default)] text-[var(--text-secondary)] text-[11px] font-semibold">CSV</button>
          <button onClick={() => window.print()} className="px-3 py-1.5 rounded-lg bg-[var(--bg-hover)] border border-[var(--border-default)] text-[var(--text-secondary)] text-[11px] font-semibold">Print</button>
        </div>
      </div>

      <StorePills
        stores={stores}
        value={exportScope === 'all' ? '' : exportScope}
        onChange={(v) => setExportScope(v || 'all')}
      />

      {loadError && <V2Alert type="danger" className="mb-3">{loadError}</V2Alert>}
      {summary && (
        <div className="text-[var(--text-muted)] text-[10px] mb-2 print:hidden">
          Data: {rawSales.length} sales ({fmt(summary.totalRevenue)}) · {rawPurch.length} purchases ({fmt(summary.totalPurchases)}) · {rawExp.length} expenses ({fmt(summary.totalExpenses)})
        </div>
      )}

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      <div className="mb-5" />

      {/* ── Hero + Stats ─────────────────────── */}
      {summary && (
        <>
          <Card padding="lg" className="mb-4 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(99,91,255,0.12), rgba(124,58,237,0.06))' }}>
            <div className="absolute top-0 right-0 w-40 h-40 opacity-10" style={{ background: 'radial-gradient(circle, var(--brand-primary), transparent 70%)', filter: 'blur(40px)' }} />
            <p className="text-[var(--text-muted)] text-[11px] font-semibold uppercase tracking-wider mb-1">Net Profit · {range.start} to {range.end}</p>
            <p className={`text-[36px] font-bold tracking-tight tabular-nums ${summary.netProfit >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
              {summary.netProfit >= 0 ? '' : '−'}{fmt(Math.abs(summary.netProfit))}
            </p>
            {summary.revenueChange != null && (
              <Badge variant={summary.revenueChange >= 0 ? 'success' : 'danger'} className="mt-1">
                {summary.revenueChange >= 0 ? '↑' : '↓'} {Math.abs(summary.revenueChange).toFixed(1)}% vs previous
              </Badge>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-4 pt-4 border-t border-[var(--border-subtle)]">
              <div><p className="text-[var(--text-muted)] text-[10px] uppercase font-semibold">Gross Sales</p><p className="text-[var(--text-primary)] text-[16px] font-bold tabular-nums">{fmt(summary.totalGross)}</p></div>
              <div><p className="text-[var(--text-muted)] text-[10px] uppercase font-semibold">Total Sales</p><p className="text-[var(--color-success)] text-[16px] font-bold tabular-nums">{fmt(summary.totalRevenue)}</p></div>
              <div><p className="text-[var(--text-muted)] text-[10px] uppercase font-semibold">Product Buying</p><p className="text-[var(--color-warning)] text-[16px] font-bold tabular-nums">{fmt(summary.totalPurchases)}</p></div>
              <div><p className="text-[var(--text-muted)] text-[10px] uppercase font-semibold">Expenses</p><p className="text-[var(--color-danger)] text-[16px] font-bold tabular-nums">{fmt(summary.totalExpenses)}</p></div>
              <div><p className="text-[var(--text-muted)] text-[10px] uppercase font-semibold">Margin</p><p style={{ color: summary.margin >= 20 ? 'var(--color-success)' : 'var(--color-warning)' }} className="text-[16px] font-bold tabular-nums">{summary.margin.toFixed(1)}%</p></div>
            </div>
          </Card>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
            <V2StatCard label="Gross Sales" value={fmt(summary.totalGross)} variant="success" icon="💰" sub={`Cash ${fmt(summary.totalCash)} · Card ${fmt(summary.totalCard)}`} />
            <V2StatCard label="Total Sales" value={fmt(summary.totalRevenue)} variant="success" icon="📊" />
            <V2StatCard label="Product Buying" value={fmt(summary.totalPurchases)} variant="warning" icon="📦" />
            <V2StatCard label="Operating Expenses" value={fmt(summary.totalExpenses)} variant="danger" icon="📋" />
            <V2StatCard label="Tax Collected" value={fmt(summary.totalTax)} variant="info" icon="🏛️" />
          </div>

          {summary.totalRevenue > 0 && (
            <div className="bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-subtle)] p-3 mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]">
              <span className="text-[var(--text-muted)] font-semibold uppercase text-[10px] tracking-wider">Payment Mix</span>
              <span>💵 Cash <span className="text-[var(--color-success)] font-bold">{fmt(summary.totalCash)}</span> <span className="text-[var(--text-muted)]">({summary.cashPct.toFixed(1)}%)</span></span>
              <span>💳 Card <span className="text-[var(--text-primary)] font-bold">{fmt(summary.totalCard)}</span> <span className="text-[var(--text-muted)]">({summary.cardPct.toFixed(1)}%)</span></span>
              <span>📱 CashApp / Check <span className="text-[var(--color-warning)] font-bold">{fmt(summary.totalCheck || 0)}</span> <span className="text-[var(--text-muted)]">({(summary.checkPct || 0).toFixed(1)}%)</span></span>
            </div>
          )}
        </>
      )}

      {/* ── Key Insights ─────────────────────────── */}
      {insights.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
          {insights.slice(0, 3).map((ins, i) => {
            const bg = { good: 'var(--color-success-bg)', bad: 'var(--color-danger-bg)', warn: 'var(--color-warning-bg)', info: 'var(--color-info-bg)' }[ins.type] || 'var(--bg-hover)';
            const color = { good: 'var(--color-success)', bad: 'var(--color-danger)', warn: 'var(--color-warning)', info: 'var(--color-info)' }[ins.type] || 'var(--text-secondary)';
            const icon = { good: '✅', bad: '🔴', warn: '⚠️', info: '📈' }[ins.type] || '📈';
            const labels = ['GROWTH', 'INSIGHT', 'PROJECTION'];
            return (
              <Card key={i} padding="md" style={{ background: bg, borderColor: color + '33' }}>
                <p className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color }}>{labels[i] || 'INSIGHT'}</p>
                <p className="text-[var(--text-primary)] text-[13px] font-semibold">{icon} {ins.text}</p>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Store Performance — only in All-Stores view ── */}
      {exportScope === 'all' && (
      <Card padding="md" className="mb-5 overflow-hidden">
        <SectionHeader title="Store Performance" />
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr><th>#</th><th>Store</th><th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>Product Buying</th><th style={{ textAlign: 'right' }}>Expenses</th><th style={{ textAlign: 'right' }}>Profit</th><th style={{ textAlign: 'right' }}>Margin</th></tr>
            </thead>
            <tbody>
              {storeRows.map((s, i) => (
                <tr key={s.id} style={i === 0 ? { background: 'rgba(251,191,36,0.06)' } : undefined}>
                  <td className="text-[var(--text-muted)] text-center">{i === 0 ? '🏆' : i + 1}</td>
                  <td><span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} /><span className="text-[var(--text-primary)] font-semibold">{s.name}</span></span></td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} className="text-[var(--color-success)] font-semibold">{fmt(s.revenue)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} className="text-[var(--text-secondary)]">{fmt(s.purchases)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} className="text-[var(--text-secondary)]">{fmt(s.expenses)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} className={`font-bold ${s.net >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>{fmt(s.net)}</td>
                  <td style={{ textAlign: 'right' }} className={`font-semibold ${s.margin >= 20 ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'}`}>{s.margin.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {storeRows.length > 0 && (
          <div className="px-3 py-2 border-t border-[var(--border-subtle)] text-[12px] font-mono flex flex-wrap gap-x-5 gap-y-1 text-[var(--text-muted)]">
            <span className="font-bold">TOTAL</span>
            <span>Revenue <span className="text-[var(--color-success)] font-bold">{fmt(totals.revenue)}</span></span>
            <span>Net <span style={{ color: soColor(totals.net) }} className="font-bold">{fmt(totals.net)}</span></span>
          </div>
        )}
      </Card>
      )}

      {/* ── Section 3 — Expenses drill-down (this vs last period) ── */}
      <div className="mb-4">
        <ComparisonList
          title="Expenses by Category"
          current={expenseRows.map(r => ({ name: `${r.icon} ${r.label}`, total: r.current }))}
          previous={expenseRows.map(r => ({ name: `${r.icon} ${r.label}`, total: r.previous }))}
          empty="No expenses in this period."
        />
      </div>

      {/* ── Section 4 — Product Buying drill-down ─────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <ComparisonList
          title="Product Buying by Item"
          current={byItem}
          previous={byItemPrev}
          empty="No purchases."
        />
        <ComparisonList
          title="Product Buying by Vendor"
          current={byVendor}
          previous={byVendorPrev}
          empty="No data."
        />
      </div>

      {/* ── P&L Waterfall ─────────────────────────── */}
      {summary && summary.totalRevenue > 0 && (
        <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)] p-4 mb-4">
          <h3 className="text-[var(--text-primary)] text-xs font-bold mb-3">P&L Waterfall</h3>
          {(() => {
            const rev = summary.totalRevenue;
            const grossPct = rev > 0 ? ((summary.grossProfit / rev) * 100).toFixed(1) : '0';
            const expPct = rev > 0 ? ((summary.totalExpenses / rev) * 100).toFixed(1) : '0';
            const netPct = rev > 0 ? ((summary.netProfit / rev) * 100).toFixed(1) : '0';
            const cogsPct = rev > 0 ? ((summary.totalPurchases / rev) * 100).toFixed(1) : '0';
            const lines = [
              { label: 'Revenue', amount: rev, pct: '100', color: '#34D399', bold: true },
              { label: '− Product Buying', amount: -summary.totalPurchases, pct: cogsPct, color: '#FBBF24' },
              { label: '= Gross Profit', amount: summary.grossProfit, pct: grossPct, color: summary.grossProfit >= 0 ? '#34D399' : '#F87171', bold: true },
              { label: '− Operating Expenses', amount: -summary.totalExpenses, pct: expPct, color: '#F87171' },
              { label: '= Net Profit', amount: summary.netProfit, pct: netPct, color: summary.netProfit >= 0 ? '#34D399' : '#F87171', bold: true },
            ];
            return (
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-44 text-[12px]" style={{ fontWeight: l.bold ? 700 : 400, color: l.bold ? '#E2E8F0' : '#94A3B8' }}>{l.label}</div>
                    <div className="flex-1 bg-[var(--bg-card)] rounded h-6 relative overflow-hidden">
                      <div className="h-full rounded" style={{ width: `${Math.min(100, Math.abs(Number(l.pct)))}%`, background: l.color + '55' }} />
                    </div>
                    <div className="w-28 text-right font-mono text-[13px]" style={{ color: l.color, fontWeight: l.bold ? 800 : 600 }}>
                      {l.amount >= 0 ? '' : '−'}{fmt(Math.abs(l.amount))}
                    </div>
                    <div className="w-12 text-right text-[10px] text-[var(--text-muted)]">{l.pct}%</div>
                  </div>
                ))}
              </div>
            );
          })()}
          {summary.netProfit > 0 && (
            <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] text-[12px] text-[var(--text-secondary)]">
              Available to distribute: <span className="text-[var(--color-success)] font-mono font-bold text-[14px]">{fmt(summary.netProfit)}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Watchouts ─────────────────────────── */}
      {watchouts.length > 0 ? (
        <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)] p-4 mb-4">
          <h3 className="text-[var(--text-primary)] text-xs font-bold mb-2">Watchouts</h3>
          <div className="space-y-1.5">
            {watchouts.map((w, i) => (
              <a key={i} href={w.link} className="flex items-center gap-2 text-[12px] hover:underline">
                <span>{w.sev === 'red' ? '🔴' : '🟡'}</span>
                <span className="text-[var(--text-primary)]">{w.text}</span>
              </a>
            ))}
          </div>
        </div>
      ) : summary && (
        <div className="bg-sw-greenD border border-sw-green/20 rounded-xl p-4 mb-4 text-[var(--color-success)] text-[12px] font-semibold text-center">
          ✅ All metrics look healthy — no watchouts this period
        </div>
      )}

      {/* ── Section 5 — Daily trend ─────────────────── */}
      <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)] p-4 mb-4">
        <h3 className="text-[var(--text-primary)] text-xs font-bold mb-2">Sales Trend</h3>
        {trendStats ? (
          <>
            <div className="flex flex-wrap gap-4 text-[11px] mb-3">
              <span>Best day: <span className="text-[var(--color-success)] font-mono font-bold">{fmt(trendStats.best.total)}</span> <span className="text-[var(--text-secondary)]">({trendStats.best.date})</span></span>
              <span>Worst day: <span className="text-[var(--color-danger)] font-mono font-bold">{fmt(trendStats.worst.total)}</span> <span className="text-[var(--text-secondary)]">({trendStats.worst.date})</span></span>
              <span>Daily avg: <span className="text-[var(--text-primary)] font-mono font-bold">{fmt(trendStats.avg)}</span></span>
              <span className="text-[var(--text-secondary)]">{trendStats.dayCount} days tracked</span>
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
        ) : <p className="text-[var(--text-muted)] text-xs text-center py-4">No sales in this period.</p>}
      </div>

      {/* ── Section 6 — Cash reconciliation ─────────────── */}
      {cashRecon && (
        <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)] p-4 mb-4">
          <h3 className="text-[var(--text-primary)] text-xs font-bold mb-2">Cash Reconciliation</h3>
          <div className="flex flex-wrap gap-4 text-[12px]">
            <span>Expected: <span className="font-mono font-bold">{fmt(cashRecon.expected)}</span></span>
            <span>Collected: <span className="font-mono font-bold">{fmt(cashRecon.collected)}</span></span>
            <span>
              Net: <span className={`font-mono font-bold ${cashRecon.diff >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
                {cashRecon.diff >= 0 ? '+' : ''}{fmt(cashRecon.diff)}
              </span>
            </span>
            <span>Short days: <span className="text-[var(--color-danger)] font-bold">{cashRecon.shortDays}</span></span>
            <span>Over days: <span className="text-[var(--color-success)] font-bold">{cashRecon.overDays}</span></span>
            <span>Pending: <span className="text-[var(--color-warning)] font-bold">{cashRecon.pendingDays}</span></span>
          </div>
        </div>
      )}
    </div>
  );
}

// Two-column list of amounts for current vs previous period. Rows merge
// on name and sort by current desc, previous rows with zero current fall
// to the bottom.
function ComparisonList({ title, current, previous, limit, empty }) {
  const prevMap = Object.fromEntries((previous || []).map(r => [r.name, r.total]));
  const curMap = Object.fromEntries((current || []).map(r => [r.name, r.total]));
  const names = Array.from(new Set([...(current || []).map(r => r.name), ...(previous || []).map(r => r.name)]));
  const merged = names.map(name => ({
    name,
    current: curMap[name] || 0,
    previous: prevMap[name] || 0,
  })).sort((a, b) => (b.current - a.current) || (b.previous - a.previous));
  const rows = limit ? merged.slice(0, limit) : merged;
  return (
    <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)] p-4">
      <h3 className="text-[var(--text-primary)] text-xs font-bold mb-2">{title}</h3>
      {rows.length === 0 ? <p className="text-[var(--text-muted)] text-xs">{empty}</p> : (
        <>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 text-[10px] uppercase font-semibold text-[var(--text-muted)] tracking-wider pb-1 mb-1 border-b border-[var(--border-subtle)]">
            <span>Name</span>
            <span className="text-right">This period</span>
            <span className="text-right">Last period</span>
          </div>
          <div className="space-y-1">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-x-3 text-[12px]">
                <span className="text-[var(--text-primary)] truncate">{r.name}</span>
                <span className="text-[var(--color-warning)] font-mono text-right tabular-nums">{fmt(r.current)}</span>
                <span className="text-[var(--text-secondary)] font-mono text-right tabular-nums">{fmt(r.previous)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
