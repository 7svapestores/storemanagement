'use client';
import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '@/components/AuthProvider';
import { generatePDF } from './generatePDF';
import { DataTable, DateBar, useDateRange, PageHeader, StatCard, Loading, StoreBadge, Alert, Button } from '@/components/UI';
import { fmt, fK, downloadCSV, EXPENSE_CATEGORIES, FIXED_EXPENSE_IDS, previousRange } from '@/lib/utils';

export default function ReportsPage() {
  const { supabase, isOwner, effectiveStoreId } = useAuth();
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
  // Raw rows captured in state so the Excel/CSV export can emit detail sheets.
  const [rawSales, setRawSales] = useState([]);
  const [rawPurch, setRawPurch] = useState([]);
  const [rawExp, setRawExp] = useState([]);
  const [rawCash, setRawCash] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedStoreId, setSelectedStoreId] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const { data: st } = await supabase.from('stores').select('*').eq('is_active', true);
        setStores(st || []);

        const prev = previousRange(range);

        // Pull everything in parallel for current and previous periods.
        const scope = (q) => effectiveStoreId ? q.eq('store_id', effectiveStoreId) : q;
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
          scope(supabase.from('purchases').select('total_cost').gte('week_of', prev.start).lte('week_of', prev.end)),
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
        const totalRevenue = (salesCur || []).reduce((s, r) => s + (r.total_sales || 0), 0);
        const totalCash = (salesCur || []).reduce((s, r) => s + (r.cash_sales || 0), 0);
        const totalCard = (salesCur || []).reduce((s, r) => s + (r.card_sales || 0), 0);
        const totalTax = (salesCur || []).reduce((s, r) => s + (r.tax_collected || 0), 0);
        const totalPurchases = (purchCur || []).reduce((s, r) => s + (r.total_cost || r.unit_cost || 0), 0);
        const totalExpenses = (expCur || []).reduce((s, r) => s + (r.amount || 0), 0);
        const grossProfit = totalRevenue - totalPurchases;
        const netProfit = totalRevenue - totalPurchases - totalExpenses;
        const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
        const cashPct = totalRevenue > 0 ? (totalCash / totalRevenue) * 100 : 0;
        const cardPct = totalRevenue > 0 ? (totalCard / totalRevenue) * 100 : 0;

        const prevRevenue = (salesPrev || []).reduce((s, r) => s + (r.total_sales || 0), 0);
        const prevPurchases = (purchPrev || []).reduce((s, r) => s + (r.total_cost || r.unit_cost || 0), 0);
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
          const pur = (purchCur || []).filter(r => r.store_id === s.id).reduce((a, r) => a + (r.total_cost || r.unit_cost || 0), 0);
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
          itemAgg[r.item] = (itemAgg[r.item] || 0) + (r.total_cost || r.unit_cost || 0);
          if (r.category) catAgg[r.category] = (catAgg[r.category] || 0) + (r.total_cost || r.unit_cost || 0);
          if (r.supplier) vendAgg[r.supplier] = (vendAgg[r.supplier] || 0) + (r.total_cost || r.unit_cost || 0);
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
  }, [range.start, range.end, effectiveStoreId]);

  // Build a single "Full Report" sheet — same shape for both Excel sheet 1 and CSV.
  const buildFullReportRows = () => {
    if (!summary) return [];
    const selectedName = effectiveStoreId
      ? (stores.find(s => s.id === effectiveStoreId)?.name || 'Store')
      : 'All Stores';
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
    rows.push(['Cash %', pct(summary.cashPct)]);
    rows.push(['Card %', pct(summary.cardPct)]);
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
    rows.push(['Store', 'Revenue', 'Cash', 'Card', 'Purchases', 'Expenses', 'Gross Profit', 'Net Profit', 'Net Margin %', 'Tax']);
    const storeTotals = { revenue: 0, cash: 0, card: 0, purchases: 0, expenses: 0, gross: 0, net: 0, tax: 0 };
    const salesByStore = {};
    rawSales.forEach(s => {
      if (!salesByStore[s.store_id]) salesByStore[s.store_id] = { cash: 0, card: 0 };
      salesByStore[s.store_id].cash += (s.cash_sales || 0);
      salesByStore[s.store_id].card += (s.card_sales || 0);
    });
    storeRows.forEach(s => {
      const sbs = salesByStore[s.id] || { cash: 0, card: 0 };
      rows.push([
        s.name,
        money(s.revenue),
        money(sbs.cash),
        money(sbs.card),
        money(s.purchases),
        money(s.expenses),
        money(s.gross),
        money(s.net),
        pct(s.margin),
        money(s.tax),
      ]);
      storeTotals.revenue += s.revenue;
      storeTotals.cash += sbs.cash;
      storeTotals.card += sbs.card;
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

  const fileTag = () => {
    const storeName = effectiveStoreId
      ? (stores.find(s => s.id === effectiveStoreId)?.name || 'Store')
      : 'AllStores';
    const safe = storeName.replace(/[^a-z0-9]+/gi, '').slice(0, 20) || 'Store';
    return `7S-${safe}-Report-${monthYearTag()}`;
  };

  const handleExportCSV = () => {
    const rows = buildFullReportRows();
    if (!rows.length) return;
    downloadCSV(`${fileTag()}.csv`, rows[0], rows.slice(1));
  };

  const handleExportExcel = () => {
    const fullRows = buildFullReportRows();
    if (!fullRows.length) return;
    const wb = XLSX.utils.book_new();

    // Sheet 1 — Full Report
    const ws1 = XLSX.utils.aoa_to_sheet(fullRows);
    // Widen columns so the first sheet is readable.
    ws1['!cols'] = [
      { wch: 36 }, { wch: 18 }, { wch: 14 }, { wch: 14 },
      { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Full Report');

    // Sheet 2 — Daily Sales (raw)
    const dailySalesRows = [
      ['Date', 'Store', 'Cash Sales', 'Card Sales', 'Total Sales', 'Credits', 'Tax', 'Entered By'],
      ...[...rawSales]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(s => [
          s.date,
          stores.find(st => st.id === s.store_id)?.name || '',
          Number(s.cash_sales || 0),
          Number(s.card_sales || 0),
          Number(s.total_sales || 0),
          Number(s.credits || 0),
          Number(s.tax_collected || 0),
          s.entered_by || '',
        ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dailySalesRows), 'Daily Sales');

    // Sheet 3 — Purchase Details
    const purchRows = [
      ['Week', 'Store', 'Item', 'Vendor', 'Quantity', 'Unit Cost', 'Total Cost'],
      ...[...rawPurch]
        .sort((a, b) => (b.week_of || '').localeCompare(a.week_of || ''))
        .map(p => [
          p.week_of,
          stores.find(st => st.id === p.store_id)?.name || '',
          p.item,
          p.supplier || '',
          Number(p.quantity || 0),
          Number(p.unit_cost || 0),
          Number(p.total_cost || 0),
        ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(purchRows), 'Purchase Details');

    // Sheet 4 — Expense Details
    const expRows = [
      ['Month', 'Store', 'Category', 'Amount', 'Note'],
      ...[...rawExp]
        .sort((a, b) => (b.month || '').localeCompare(a.month || ''))
        .map(e => [
          e.month,
          stores.find(st => st.id === e.store_id)?.name || '',
          EXPENSE_CATEGORIES.find(c => c.id === e.category)?.label || e.category,
          Number(e.amount || 0),
          e.note || '',
        ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expRows), 'Expense Details');

    // Sheet 5 — Cash Collections
    const cashRows = [
      ['Date', 'Store', 'Cash Collected', 'Note'],
      ...[...rawCash]
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .map(c => [
          c.date,
          stores.find(st => st.id === c.store_id)?.name || '',
          Number(c.cash_collected || 0),
          c.note || '',
        ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cashRows), 'Cash Collections');

    XLSX.writeFile(wb, `${fileTag()}.xlsx`);
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
      insights.push({ type: 'info', text: `On track for ~${fK(dailyProfit * 30)}/month net profit` });
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

  return (
    <div className="print:bg-white print:text-black">
      <PageHeader title="📑 P&L Report" subtitle={`${range.start} to ${range.end}`}>
        <Button variant="secondary" onClick={() => {
          const pdf = generatePDF({ summary, storeRows, expenseRows, byVendor, dailyTrend, trendStats, cashRecon, insights, watchouts, rawSales, rawPurch, rawExp, stores }, range);
          pdf.save(`7S-Stores-Report-${range.start}-to-${range.end}.pdf`);
        }} className="!text-[11px]">📄 PDF</Button>
        <Button variant="secondary" onClick={handleExportExcel} className="!text-[11px]">📊 Excel</Button>
        <Button variant="secondary" onClick={handleExportCSV} className="!text-[11px]">📥 CSV</Button>
        <Button variant="secondary" onClick={() => typeof window !== 'undefined' && window.print()} className="!text-[11px]">🖨️ Print</Button>
      </PageHeader>

      {loadError && <Alert type="error">{loadError}</Alert>}
      {summary && (
        <div className="text-sw-dim text-[10px] mb-2">
          Data: {rawSales.length} sales ({fmt(summary.totalRevenue)}) · {rawPurch.length} purchases ({fmt(summary.totalPurchases)}) · {rawExp.length} expenses ({fmt(summary.totalExpenses)})
        </div>
      )}

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      {/* Tabs */}
      <div className="flex gap-1.5 overflow-x-auto mb-4 pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
        {[
          { id: 'overview', label: '📊 Overview' },
          { id: 'stores', label: '🏪 By Store' },
          { id: 'store-detail', label: '📍 Store Detail' },
          { id: 'expenses', label: '💸 Expenses' },
          { id: 'purchases', label: '📦 COGS' },
          { id: 'watchouts', label: '⚠️ Watchouts' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap transition-colors flex-shrink-0
              ${activeTab === t.id ? 'bg-sw-blue text-black shadow' : 'bg-sw-card2 text-sw-sub border border-sw-border hover:text-sw-text'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB: OVERVIEW ─────────────────────── */}
      {activeTab === 'overview' && <>

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

      {/* ── Key Insights ─────────────────────────── */}
      {insights.length > 0 && (
        <div className="bg-sw-card rounded-xl border border-sw-border p-4 mb-4">
          <h3 className="text-sw-text text-xs font-bold mb-2">Key Insights</h3>
          <div className="space-y-1.5">
            {insights.map((ins, i) => (
              <div key={i} className="flex items-start gap-2 text-[12px]">
                <span className="flex-shrink-0">{ins.type === 'good' ? '✅' : ins.type === 'bad' ? '🔴' : ins.type === 'warn' ? '⚠️' : '📈'}</span>
                <span className="text-sw-text">{ins.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      </>}

      {/* ── TAB: BY STORE ─────────────────────── */}
      {(activeTab === 'stores' || activeTab === 'overview') && <>

      {/* ── Section 2 — Store breakdown ─────────────── */}
      <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden mb-4">
        <div className="px-3 py-2 border-b border-sw-border">
          <h3 className="text-sw-text text-xs font-bold">Store-by-Store Breakdown</h3>
        </div>
        <DataTable
          emptyMessage="No sales in this period yet."
          columns={[
            { key: 'name', label: 'Store', render: (v, r) => {
              const rank = storeRows.findIndex(s => s.id === r.id);
              return <span className="flex items-center gap-1.5">{rank === 0 ? '🏆' : ''}<StoreBadge name={v} color={r.color} /></span>;
            } },
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

      </>}

      {/* ── TAB: EXPENSES ─────────────────────── */}
      {(activeTab === 'expenses' || activeTab === 'overview') && <>

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

      </>}

      {/* ── TAB: PURCHASES/COGS ─────────────────────── */}
      {(activeTab === 'purchases' || activeTab === 'overview') && <>

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

      {/* ── P&L Waterfall ─────────────────────────── */}
      {summary && summary.totalRevenue > 0 && (
        <div className="bg-sw-card rounded-xl border border-sw-border p-4 mb-4">
          <h3 className="text-sw-text text-xs font-bold mb-3">P&L Waterfall</h3>
          {(() => {
            const rev = summary.totalRevenue;
            const grossPct = rev > 0 ? ((summary.grossProfit / rev) * 100).toFixed(1) : '0';
            const expPct = rev > 0 ? ((summary.totalExpenses / rev) * 100).toFixed(1) : '0';
            const netPct = rev > 0 ? ((summary.netProfit / rev) * 100).toFixed(1) : '0';
            const cogsPct = rev > 0 ? ((summary.totalPurchases / rev) * 100).toFixed(1) : '0';
            const lines = [
              { label: 'Revenue', amount: rev, pct: '100', color: '#34D399', bold: true },
              { label: '− COGS (Purchases)', amount: -summary.totalPurchases, pct: cogsPct, color: '#FBBF24' },
              { label: '= Gross Profit', amount: summary.grossProfit, pct: grossPct, color: summary.grossProfit >= 0 ? '#34D399' : '#F87171', bold: true },
              { label: '− Operating Expenses', amount: -summary.totalExpenses, pct: expPct, color: '#F87171' },
              { label: '= Net Profit', amount: summary.netProfit, pct: netPct, color: summary.netProfit >= 0 ? '#34D399' : '#F87171', bold: true },
            ];
            return (
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-44 text-[12px]" style={{ fontWeight: l.bold ? 700 : 400, color: l.bold ? '#E2E8F0' : '#94A3B8' }}>{l.label}</div>
                    <div className="flex-1 bg-sw-card2 rounded h-6 relative overflow-hidden">
                      <div className="h-full rounded" style={{ width: `${Math.min(100, Math.abs(Number(l.pct)))}%`, background: l.color + '55' }} />
                    </div>
                    <div className="w-28 text-right font-mono text-[13px]" style={{ color: l.color, fontWeight: l.bold ? 800 : 600 }}>
                      {l.amount >= 0 ? '' : '−'}{fmt(Math.abs(l.amount))}
                    </div>
                    <div className="w-12 text-right text-[10px] text-sw-dim">{l.pct}%</div>
                  </div>
                ))}
              </div>
            );
          })()}
          {summary.netProfit > 0 && (
            <div className="mt-4 pt-3 border-t border-sw-border text-[12px] text-sw-sub">
              Available to distribute: <span className="text-sw-green font-mono font-bold text-[14px]">{fmt(summary.netProfit)}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Watchouts ─────────────────────────── */}
      {watchouts.length > 0 ? (
        <div className="bg-sw-card rounded-xl border border-sw-border p-4 mb-4">
          <h3 className="text-sw-text text-xs font-bold mb-2">Watchouts</h3>
          <div className="space-y-1.5">
            {watchouts.map((w, i) => (
              <a key={i} href={w.link} className="flex items-center gap-2 text-[12px] hover:underline">
                <span>{w.sev === 'red' ? '🔴' : '🟡'}</span>
                <span className="text-sw-text">{w.text}</span>
              </a>
            ))}
          </div>
        </div>
      ) : summary && (
        <div className="bg-sw-greenD border border-sw-green/20 rounded-xl p-4 mb-4 text-sw-green text-[12px] font-semibold text-center">
          ✅ All metrics look healthy — no watchouts this period
        </div>
      )}

      </>}

      {/* ── TAB: OVERVIEW cont — trend ─────────────────── */}
      {activeTab === 'overview' && <>

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

      </>}

      {/* ── TAB: OVERVIEW cont — cash ─────────────────── */}
      {activeTab === 'overview' && <>

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
      </>}

      {/* ── TAB: STORE DETAIL ─────────────────────── */}
      {activeTab === 'store-detail' && (() => {
        const ss = selectedStoreId ? storeRows.find(s => s.id === selectedStoreId) : null;
        const stSales = ss ? rawSales.filter(r => r.store_id === ss.id) : [];
        const stPurch = ss ? rawPurch.filter(r => r.store_id === ss.id) : [];
        const stExp = ss ? rawExp.filter(r => r.store_id === ss.id) : [];
        const stRevenue = stSales.reduce((s, r) => s + (r.total_sales || 0), 0);
        const stCOGS = stPurch.reduce((s, r) => s + (r.total_cost || r.unit_cost || 0), 0);
        const stExpenses = stExp.reduce((s, r) => s + (r.amount || 0), 0);
        const stNet = stRevenue - stCOGS - stExpenses;
        const stMargin = stRevenue > 0 ? (stNet / stRevenue * 100).toFixed(1) : '0';

        // Top expense categories for this store
        const stExpByCat = {};
        stExp.forEach(r => { stExpByCat[r.category] = (stExpByCat[r.category] || 0) + (r.amount || 0); });
        const stExpCats = Object.entries(stExpByCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const stExpMax = Math.max(1, ...stExpCats.map(([_, v]) => v));

        // Top vendors for this store
        const stVendMap = {};
        stPurch.forEach(r => { stVendMap[r.supplier || 'Unknown'] = (stVendMap[r.supplier || 'Unknown'] || 0) + (r.total_cost || r.unit_cost || 0); });
        const stVendors = Object.entries(stVendMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const stVendMax = Math.max(1, ...stVendors.map(([_, v]) => v));

        return (
          <>
            <div className="bg-sw-card rounded-lg p-2.5 border border-sw-border mb-4 flex gap-2 items-center flex-wrap">
              <label className="text-sw-sub text-[10px] font-bold uppercase">Store</label>
              <select value={selectedStoreId} onChange={e => setSelectedStoreId(e.target.value)} className="!w-auto !min-w-[200px] !py-1.5 !text-[11px]">
                <option value="">Select a store…</option>
                {storeRows.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            {ss ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-4 h-4 rounded" style={{ background: ss.color }} />
                  <h2 className="text-sw-text text-[18px] font-bold">{ss.name}</h2>
                  {storeRows.indexOf(ss) === 0 && <span className="text-[14px]">🏆</span>}
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
                  <StatCard label="Revenue" value={fK(stRevenue)} icon="💰" color="#34D399" />
                  <StatCard label="COGS" value={fK(stCOGS)} icon="📦" color="#FBBF24" />
                  <StatCard label="Expenses" value={fK(stExpenses)} icon="📋" color="#F87171" />
                  <StatCard label="Net Profit" value={fK(stNet)} icon={stNet >= 0 ? '✅' : '⚠️'} color={stNet >= 0 ? '#34D399' : '#F87171'} />
                  <StatCard label="Margin" value={`${stMargin}%`} icon="📊" color={Number(stMargin) >= 20 ? '#34D399' : '#FBBF24'} />
                </div>

                {/* Mini waterfall */}
                {stRevenue > 0 && (
                  <div className="bg-sw-card rounded-xl border border-sw-border p-4">
                    <h3 className="text-sw-text text-xs font-bold mb-2">P&L Breakdown</h3>
                    <div className="space-y-1.5 text-[12px]">
                      {[
                        { label: 'Revenue', val: stRevenue, color: '#34D399' },
                        { label: '− COGS', val: -stCOGS, color: '#FBBF24' },
                        { label: '= Gross Profit', val: stRevenue - stCOGS, color: '#34D399' },
                        { label: '− Expenses', val: -stExpenses, color: '#F87171' },
                        { label: '= Net Profit', val: stNet, color: stNet >= 0 ? '#34D399' : '#F87171' },
                      ].map((l, i) => (
                        <div key={i} className="flex justify-between">
                          <span className="text-sw-sub">{l.label}</span>
                          <span className="font-mono font-bold" style={{ color: l.color }}>{l.val >= 0 ? '' : '−'}{fmt(Math.abs(l.val))}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Top expense categories */}
                  <div className="bg-sw-card rounded-xl border border-sw-border p-4">
                    <h3 className="text-sw-text text-xs font-bold mb-2">Top Expenses</h3>
                    <div className="space-y-1.5">
                      {stExpCats.map(([cat, amt]) => {
                        const meta = EXPENSE_CATEGORIES.find(c => c.id === cat);
                        return (
                          <div key={cat} className="flex items-center gap-2">
                            <span className="w-24 text-sw-sub text-[11px] truncate">{meta?.icon || '📋'} {meta?.label || cat}</span>
                            <div className="flex-1 bg-sw-card2 rounded h-3"><div className="h-full bg-sw-red/40 rounded" style={{ width: `${(amt / stExpMax) * 100}%` }} /></div>
                            <span className="w-16 text-right font-mono text-[11px] text-sw-text">{fmt(amt)}</span>
                          </div>
                        );
                      })}
                      {stExpCats.length === 0 && <p className="text-sw-dim text-[11px]">No expenses</p>}
                    </div>
                  </div>
                  {/* Top vendors */}
                  <div className="bg-sw-card rounded-xl border border-sw-border p-4">
                    <h3 className="text-sw-text text-xs font-bold mb-2">Top Vendors (COGS)</h3>
                    <div className="space-y-1.5">
                      {stVendors.map(([vend, amt]) => (
                        <div key={vend} className="flex items-center gap-2">
                          <span className="w-24 text-sw-sub text-[11px] truncate">{vend}</span>
                          <div className="flex-1 bg-sw-card2 rounded h-3"><div className="h-full bg-sw-amber/40 rounded" style={{ width: `${(amt / stVendMax) * 100}%` }} /></div>
                          <span className="w-16 text-right font-mono text-[11px] text-sw-text">{fmt(amt)}</span>
                        </div>
                      ))}
                      {stVendors.length === 0 && <p className="text-sw-dim text-[11px]">No purchases</p>}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-sw-card border border-sw-border rounded-xl p-8 text-center text-sw-dim">
                Select a store above to see its detailed P&L breakdown.
              </div>
            )}
          </>
        );
      })()}

      {/* ── TAB: WATCHOUTS ─────────────────────── */}
      {activeTab === 'watchouts' && (
        <>
          {watchouts.length > 0 ? (
            <div className="space-y-2">
              {watchouts.map((w, i) => (
                <a key={i} href={w.link} className="bg-sw-card rounded-xl border border-sw-border p-4 flex items-start gap-3 hover:border-sw-blue/30 transition-colors block">
                  <span className="text-[18px] flex-shrink-0">{w.sev === 'red' ? '🔴' : '🟡'}</span>
                  <div>
                    <div className="text-sw-text text-[13px] font-semibold">{w.text}</div>
                    <div className="text-sw-dim text-[10px] mt-0.5">Click to investigate →</div>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="bg-sw-greenD border border-sw-green/20 rounded-xl p-8 text-center">
              <div className="text-[28px] mb-2">✅</div>
              <div className="text-sw-green text-[14px] font-bold">All metrics look healthy</div>
              <div className="text-sw-dim text-[11px] mt-1">No watchouts this period</div>
            </div>
          )}
          {insights.length > 0 && (
            <div className="bg-sw-card rounded-xl border border-sw-border p-4 mt-4">
              <h3 className="text-sw-text text-xs font-bold mb-2">All Insights</h3>
              <div className="space-y-1.5">
                {insights.map((ins, i) => (
                  <div key={i} className="flex items-start gap-2 text-[12px]">
                    <span className="flex-shrink-0">{ins.type === 'good' ? '✅' : ins.type === 'bad' ? '🔴' : ins.type === 'warn' ? '⚠️' : '📈'}</span>
                    <span className="text-sw-text">{ins.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
