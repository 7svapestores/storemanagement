// Branded P&L Excel generator for 7S Stores.
//
// Uses ExcelJS so we can emit real styling, merges, number formats,
// and conditional formatting (data bars, color scales, cell rules).
//
// Follows the design spec: title banner, KPI cards, section bands, zebra
// tables, per-section accent colors, TOTAL rows via formulas, frozen panes,
// hidden gridlines, landscape-fit print setup.
//
// Charts sheet is intentionally skipped for now — ExcelJS's chart support
// is limited and the dashboard already surfaces the key metrics.

const COLORS = {
  navy:      '1F3A5F',
  darkNavy:  '0F2440',
  teal:      '2E7D7D',
  redBrown:  '8B3A3A',
  green:     '1B5E20',
  greenMed:  '2E7D32',
  purple:    '6A4C93',
  orange:    'E65100',
  tealGreen: '00695C',
  bgLight:   'F5F7FA',
  white:     'FFFFFF',
  gold:      'C9A961',
  greenBg:   'E8F5E9',
  greenText: '1B5E20',
  redBg:     'FFEBEE',
  redText:   'B71C1C',
  amberBg:   'FFF8E1',
  amberText: 'E65100',
  border:    'D0D7DE',
};

const FMT = {
  money:     '"$"#,##0.00',
  moneyNeg:  '"$"#,##0.00;[Red]("$"#,##0.00)',
  moneyZero: '"$"#,##0.00;;"–"',
  pct1:      '0.0%',
  pct2:      '0.00%',
  int:       '#,##0',
};

const FONT = 'Calibri';

function fill(color) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + color } };
}

function thinBorder(color = COLORS.border) {
  const side = { style: 'thin', color: { argb: 'FF' + color } };
  return { top: side, left: side, right: side, bottom: side };
}

function mediumBorderTopBottom(color) {
  const side = { style: 'medium', color: { argb: 'FF' + color } };
  const thin = { style: 'thin', color: { argb: 'FF' + COLORS.border } };
  return { top: side, bottom: side, left: thin, right: thin };
}

function applyRow(row, opts) {
  row.eachCell({ includeEmpty: true }, cell => {
    if (opts.fill)   cell.fill = opts.fill;
    if (opts.font)   cell.font = { name: FONT, ...opts.font };
    if (opts.border) cell.border = opts.border;
    if (opts.align)  cell.alignment = opts.align;
    if (opts.format) cell.numFmt = opts.format;
  });
}

function zebra(ws, firstDataRow, lastDataRow, firstCol, lastCol) {
  for (let r = firstDataRow; r <= lastDataRow; r++) {
    const isEven = (r - firstDataRow) % 2 === 1;
    const color = isEven ? COLORS.bgLight : COLORS.white;
    for (let c = firstCol; c <= lastCol; c++) {
      const cell = ws.getCell(r, c);
      cell.fill = fill(color);
      cell.border = thinBorder();
      if (!cell.font) cell.font = { name: FONT, size: 10 };
      else cell.font = { name: FONT, size: 10, ...cell.font };
    }
  }
}

function sectionHeader(ws, row, text, bgColor, colSpan = 10) {
  ws.mergeCells(row, 1, row, colSpan);
  const cell = ws.getCell(row, 1);
  cell.value = text;
  cell.fill = fill(bgColor);
  cell.font = { name: FONT, size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  ws.getRow(row).height = 28;
}

function columnLetter(c) {
  let s = '';
  while (c > 0) {
    const m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
}

function tableHeaderRow(ws, row, headers, bgColor) {
  headers.forEach((h, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = h;
    cell.fill = fill(bgColor);
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: i === 0 ? 'left' : 'right', vertical: 'middle' };
    cell.border = thinBorder();
  });
  ws.getRow(row).height = 22;
}

function totalRow(ws, row, values, accentColor, leftAlignFirst = true) {
  values.forEach((v, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = v;
    cell.fill = fill(accentColor);
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: i === 0 && leftAlignFirst ? 'left' : 'right', vertical: 'middle' };
    cell.border = mediumBorderTopBottom(accentColor);
  });
  ws.getRow(row).height = 22;
}

// ─── Dashboard builder ───────────────────────────────────────────────

function buildDashboard(wb, bundle, range) {
  const ws = wb.addWorksheet('P&L Dashboard', {
    views: [{ showGridLines: false, state: 'frozen', xSplit: 0, ySplit: 4 }],
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0.2, footer: 0.2 },
    },
  });

  // Column widths
  const widths = [32, 16, 14, 14, 15, 14, 15, 15, 14, 14];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const { summary, storeRows, rawSales, rawPurch, rawExp, rawCash, scopeName, expenseCategories, fixedExpenseIds, stores } = bundle;
  const s = summary || {};

  // Row 1 — Title banner
  ws.mergeCells('A1:J1');
  const title = ws.getCell('A1');
  title.value = '7S STORES  ·  PROFIT & LOSS REPORT';
  title.fill = fill(COLORS.darkNavy);
  title.font = { name: FONT, size: 22, bold: true, color: { argb: 'FFFFFFFF' } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 42;

  // Row 2 — Subtitle
  ws.mergeCells('A2:J2');
  const sub = ws.getCell('A2');
  const genDate = new Date().toISOString().slice(0, 10);
  sub.value = `Period: ${range.start} – ${range.end}   |   ${scopeName || 'All Stores'}   |   Generated: ${genDate}`;
  sub.fill = fill(COLORS.navy);
  sub.font = { name: FONT, size: 11, italic: true, color: { argb: 'FFFFFFFF' } };
  sub.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 22;

  // Row 3 — spacer (blank)
  ws.getRow(3).height = 8;

  // Rows 4–5 — KPI cards
  const kpis = [
    { label: 'Total Revenue',  value: s.totalRevenue,    headBg: COLORS.navy,    valColor: COLORS.navy,      fmt: FMT.money },
    { label: 'Gross Profit',   value: s.grossProfit,     headBg: COLORS.green,   valColor: COLORS.green,     fmt: FMT.moneyNeg },
    { label: 'Net Profit',     value: s.netProfit,       headBg: COLORS.greenMed,valColor: COLORS.green,     fmt: FMT.moneyNeg },
    { label: 'Net Margin',     value: (s.margin || 0)/100,headBg: COLORS.darkNavy,valColor: COLORS.gold,      fmt: FMT.pct1 },
  ];
  const cardRanges = [[1,3],[4,5],[6,7],[8,10]];
  kpis.forEach((k, i) => {
    const [start, end] = cardRanges[i];
    ws.mergeCells(4, start, 4, end);
    ws.mergeCells(5, start, 5, end);
    const head = ws.getCell(4, start);
    head.value = k.label;
    head.fill = fill(k.headBg);
    head.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    head.alignment = { horizontal: 'center', vertical: 'middle' };
    head.border = thinBorder();
    const val = ws.getCell(5, start);
    val.value = k.value ?? 0;
    val.numFmt = k.fmt;
    val.fill = fill(COLORS.white);
    val.font = { name: FONT, size: 20, bold: true, color: { argb: 'FF' + k.valColor } };
    val.alignment = { horizontal: 'center', vertical: 'middle' };
    val.border = thinBorder();
  });
  ws.getRow(4).height = 22;
  ws.getRow(5).height = 38;

  // Row 6 — spacer
  let r = 6;
  ws.getRow(r++).height = 8;

  // ─── Revenue Summary ─────────────────────────────────────────────
  sectionHeader(ws, r++, '💰  REVENUE SUMMARY', COLORS.teal);
  tableHeaderRow(ws, r++, ['Metric','Amount','','','','','','','',''], COLORS.teal);
  const revenueRows = [
    ['Total Revenue',            s.totalRevenue || 0,  FMT.money],
    ['Total Cash Sales',         s.totalCash || 0,     FMT.money],
    ['Total Card Sales',         s.totalCard || 0,     FMT.money],
    ['Total CashApp / Check',    s.totalCheck || 0,    FMT.money],
    ['Cash %',                   (s.cashPct || 0)/100, FMT.pct1],
    ['Card %',                   (s.cardPct || 0)/100, FMT.pct1],
    ['CashApp / Check %',        (s.checkPct || 0)/100,FMT.pct1],
    ['Tax Collected',            s.totalTax || 0,      FMT.money],
  ];
  const revStart = r;
  revenueRows.forEach(([label, value, fmt]) => {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).alignment = { horizontal: 'left', indent: 1 };
    const vc = ws.getCell(r, 2);
    vc.value = value;
    vc.numFmt = fmt;
    vc.alignment = { horizontal: 'right' };
    r++;
  });
  zebra(ws, revStart, r - 1, 1, 2);
  ws.getRow(r).height = 2;
  r++;

  // ─── Cost Summary ───────────────────────────────────────────────
  sectionHeader(ws, r++, '📉  COST SUMMARY', COLORS.redBrown);
  tableHeaderRow(ws, r++, ['Metric','Amount','','','','','','','',''], COLORS.redBrown);
  const costStart = r;
  const costRows = [
    ['Total Purchases (Product Buying)', s.totalPurchases || 0, FMT.money],
    ['Total Expenses (Operating)',       s.totalExpenses || 0,  FMT.money],
  ];
  costRows.forEach(([label, value, fmt]) => {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).alignment = { horizontal: 'left', indent: 1 };
    const vc = ws.getCell(r, 2);
    vc.value = value;
    vc.numFmt = fmt;
    vc.alignment = { horizontal: 'right' };
    r++;
  });
  zebra(ws, costStart, r - 1, 1, 2);
  totalRow(ws, r, [
    'Total Costs',
    { formula: `SUM(B${costStart}:B${r-1})`, result: (s.totalPurchases || 0) + (s.totalExpenses || 0) },
    '','','','','','','','',
  ], COLORS.redBrown);
  ws.getCell(r, 2).numFmt = FMT.money;
  r++;
  ws.getRow(r).height = 2;
  r++;

  // ─── Profit Calculation ─────────────────────────────────────────
  sectionHeader(ws, r++, '📈  PROFIT CALCULATION', COLORS.green);
  tableHeaderRow(ws, r++, ['Metric','Amount','','','','','','','',''], COLORS.green);
  const profitStart = r;
  const profitRows = [
    ['Gross Profit (Revenue − Purchases)',            s.grossProfit || 0, FMT.moneyNeg],
    ['Net Profit (Revenue − Purchases − Expenses)',   s.netProfit || 0,   FMT.moneyNeg],
    ['Gross Margin %',                                 s.totalRevenue > 0 ? (s.grossProfit / s.totalRevenue) : 0, FMT.pct1],
    ['Net Margin %',                                   (s.margin || 0)/100, FMT.pct1],
  ];
  profitRows.forEach(([label, value, fmt]) => {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).alignment = { horizontal: 'left', indent: 1 };
    const vc = ws.getCell(r, 2);
    vc.value = value;
    vc.numFmt = fmt;
    vc.alignment = { horizontal: 'right' };
    r++;
  });
  zebra(ws, profitStart, r - 1, 1, 2);
  // Highlight net profit green/red depending on sign
  const netProfitCell = ws.getCell(profitStart + 1, 2);
  const netIsPositive = (s.netProfit || 0) >= 0;
  netProfitCell.fill = fill(netIsPositive ? COLORS.greenBg : COLORS.redBg);
  netProfitCell.font = { name: FONT, size: 11, bold: true, color: { argb: 'FF' + (netIsPositive ? COLORS.greenText : COLORS.redText) } };
  ws.getRow(r).height = 2;
  r++;

  // ─── Store Performance ──────────────────────────────────────────
  sectionHeader(ws, r++, '🏪  STORE-BY-STORE PERFORMANCE', COLORS.teal);
  const spHeaders = ['Store','Revenue','Cash','Card','CashApp/Check','Purchases','Expenses','Gross','Net','Margin'];
  tableHeaderRow(ws, r++, spHeaders, COLORS.teal);
  const spStart = r;
  (storeRows || []).forEach(s => {
    const row = [
      s.name,
      s.revenue || 0,
      s.cash || 0,
      s.card || 0,
      s.check || 0,
      s.purchases || 0,
      s.expenses || 0,
      s.gross || 0,
      s.net || 0,
      (s.margin || 0) / 100,
    ];
    row.forEach((v, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = v;
      cell.alignment = { horizontal: i === 0 ? 'left' : 'right', indent: i === 0 ? 1 : 0 };
      if (i === 0) {
        // nothing, just text
      } else if (i === 9) {
        cell.numFmt = FMT.pct1;
      } else {
        cell.numFmt = i === 8 ? FMT.moneyNeg : FMT.money;
      }
    });
    r++;
  });
  const spEnd = r - 1;
  zebra(ws, spStart, spEnd, 1, spHeaders.length);
  // TOTAL row with formulas
  const tRow = r;
  const totalVals = ['TOTAL'];
  for (let c = 2; c <= 9; c++) {
    const colL = columnLetter(c);
    totalVals.push({ formula: `SUM(${colL}${spStart}:${colL}${spEnd})`, result: 0 });
  }
  // Net Margin total: Net / Revenue
  totalVals.push({ formula: `IFERROR(I${tRow}/B${tRow},0)`, result: 0 });
  totalRow(ws, r, totalVals, COLORS.teal);
  for (let c = 2; c <= 8; c++) ws.getCell(r, c).numFmt = FMT.money;
  ws.getCell(r, 9).numFmt = FMT.moneyNeg;
  ws.getCell(r, 10).numFmt = FMT.pct1;
  r++;
  // Data bars on Net Profit, color scale on Margin
  if (spEnd >= spStart) {
    ws.addConditionalFormatting({
      ref: `I${spStart}:I${spEnd}`,
      rules: [{
        type: 'dataBar',
        priority: 1,
        cfvo: [{ type: 'min' }, { type: 'max' }],
        color: { argb: 'FF4CAF50' },
        gradient: true,
      }],
    });
    ws.addConditionalFormatting({
      ref: `J${spStart}:J${spEnd}`,
      rules: [{
        type: 'colorScale',
        priority: 2,
        cfvo: [
          { type: 'min' },
          { type: 'percentile', value: 50 },
          { type: 'max' },
        ],
        color: [
          { argb: 'FFF8BBD0' },
          { argb: 'FFFFF9C4' },
          { argb: 'FFC8E6C9' },
        ],
      }],
    });
  }
  ws.getRow(r).height = 2;
  r++;

  // ─── Expenses by Category (matrix) ─────────────────────────────
  sectionHeader(ws, r++, '💼  EXPENSES BY CATEGORY', COLORS.purple);
  const expStoreList = (storeRows || []);
  const categoryHeader = ['Category', ...expStoreList.map(s => s.name), 'TOTAL'];
  // May exceed column J if many stores; limit to A-J and pad if needed
  tableHeaderRow(ws, r++, categoryHeader.concat(Array(Math.max(0, 10 - categoryHeader.length)).fill('')), COLORS.purple);
  const expStart = r;
  const seenCustom = new Set();
  (rawExp || []).forEach(e => { if (!fixedExpenseIds?.has?.(e.category)) seenCustom.add(e.category); });
  const allCategories = [
    ...(expenseCategories || []).map(c => ({ id: c.id, label: `${c.icon || '📋'} ${c.label}` })),
    ...[...seenCustom].sort().map(id => ({ id, label: `✨ ${id}` })),
  ];
  const expTotalCol = expStoreList.length + 2; // Category + stores + TOTAL
  const rowsWritten = [];
  allCategories.forEach(cat => {
    const storeAmounts = expStoreList.map(st =>
      (rawExp || []).filter(e => e.store_id === st.id && e.category === cat.id).reduce((sum, e) => sum + (e.amount || 0), 0)
    );
    const rowTotal = storeAmounts.reduce((a, b) => a + b, 0);
    if (rowTotal === 0 && storeAmounts.every(v => v === 0)) return; // skip empty
    ws.getCell(r, 1).value = cat.label;
    ws.getCell(r, 1).alignment = { horizontal: 'left', indent: 1 };
    storeAmounts.forEach((amt, i) => {
      const cell = ws.getCell(r, i + 2);
      cell.value = amt;
      cell.numFmt = FMT.moneyZero;
      cell.alignment = { horizontal: 'right' };
    });
    // TOTAL col as formula
    const firstStoreCol = columnLetter(2);
    const lastStoreCol = columnLetter(expStoreList.length + 1);
    const totCell = ws.getCell(r, expTotalCol);
    totCell.value = { formula: `SUM(${firstStoreCol}${r}:${lastStoreCol}${r})`, result: rowTotal };
    totCell.numFmt = FMT.money;
    totCell.alignment = { horizontal: 'right' };
    totCell.font = { name: FONT, size: 10, bold: true };
    rowsWritten.push(r);
    r++;
  });
  const expEnd = r - 1;
  if (rowsWritten.length > 0) {
    zebra(ws, expStart, expEnd, 1, expTotalCol);
    // TOTAL row
    const totalsByStore = expStoreList.map(st =>
      (rawExp || []).filter(e => e.store_id === st.id).reduce((sum, e) => sum + (e.amount || 0), 0)
    );
    const grandExp = totalsByStore.reduce((a, b) => a + b, 0);
    const firstStoreCol = columnLetter(2);
    const lastStoreCol = columnLetter(expStoreList.length + 1);
    const vals = ['TOTAL'];
    for (let c = 2; c <= expStoreList.length + 1; c++) {
      const L = columnLetter(c);
      vals.push({ formula: `SUM(${L}${expStart}:${L}${expEnd})`, result: totalsByStore[c - 2] || 0 });
    }
    vals.push({ formula: `SUM(${firstStoreCol}${r}:${lastStoreCol}${r})`, result: grandExp });
    // pad to 10 cols
    while (vals.length < 10) vals.push('');
    totalRow(ws, r, vals, COLORS.purple);
    for (let c = 2; c <= expTotalCol; c++) ws.getCell(r, c).numFmt = FMT.money;
    // Data bars on TOTAL column
    ws.addConditionalFormatting({
      ref: `${columnLetter(expTotalCol)}${expStart}:${columnLetter(expTotalCol)}${expEnd}`,
      rules: [{
        type: 'dataBar',
        priority: 3,
        cfvo: [{ type: 'min' }, { type: 'max' }],
        color: { argb: 'FFBA68C8' },
        gradient: true,
      }],
    });
    r++;
  } else {
    ws.getCell(r, 1).value = 'No expenses recorded.';
    ws.getCell(r, 1).font = { name: FONT, size: 10, italic: true, color: { argb: 'FF9CA3AF' } };
    r++;
  }
  ws.getRow(r).height = 2;
  r++;

  // ─── Product Buying by Vendor ───────────────────────────────────
  sectionHeader(ws, r++, '📦  PRODUCT BUYING BY VENDOR', COLORS.orange);
  tableHeaderRow(ws, r++, ['Vendor','Amount','% of Total','','','','','','',''], COLORS.orange);
  const vendStart = r;
  const vendMap = {};
  (rawPurch || []).forEach(p => {
    const key = p.supplier || 'Unknown';
    vendMap[key] = (vendMap[key] || 0) + (p.total_cost || p.unit_cost || 0);
  });
  const vendorEntries = Object.entries(vendMap).sort((a, b) => b[1] - a[1]);
  const vendTotal = s.totalPurchases || vendorEntries.reduce((a, [, v]) => a + v, 0);
  vendorEntries.forEach(([name, amount]) => {
    ws.getCell(r, 1).value = name;
    ws.getCell(r, 1).alignment = { horizontal: 'left', indent: 1 };
    const amtCell = ws.getCell(r, 2);
    amtCell.value = amount;
    amtCell.numFmt = FMT.money;
    amtCell.alignment = { horizontal: 'right' };
    const pctCell = ws.getCell(r, 3);
    pctCell.value = vendTotal > 0 ? amount / vendTotal : 0;
    pctCell.numFmt = FMT.pct2;
    pctCell.alignment = { horizontal: 'right' };
    r++;
  });
  const vendEnd = r - 1;
  if (vendorEntries.length > 0) {
    zebra(ws, vendStart, vendEnd, 1, 3);
    totalRow(ws, r, [
      'TOTAL',
      { formula: `SUM(B${vendStart}:B${vendEnd})`, result: vendTotal },
      1,
      '','','','','','','',
    ], COLORS.orange);
    ws.getCell(r, 2).numFmt = FMT.money;
    ws.getCell(r, 3).numFmt = FMT.pct2;
    // Data bars on Amount
    ws.addConditionalFormatting({
      ref: `B${vendStart}:B${vendEnd}`,
      rules: [{
        type: 'dataBar',
        priority: 4,
        cfvo: [{ type: 'min' }, { type: 'max' }],
        color: { argb: 'FFFFAB40' },
        gradient: true,
      }],
    });
    r++;
  } else {
    ws.getCell(r, 1).value = 'No purchase data.';
    ws.getCell(r, 1).font = { name: FONT, size: 10, italic: true, color: { argb: 'FF9CA3AF' } };
    r++;
  }
  ws.getRow(r).height = 2;
  r++;

  // ─── Cash Reconciliation ───────────────────────────────────────
  sectionHeader(ws, r++, '💵  CASH RECONCILIATION', COLORS.tealGreen);
  tableHeaderRow(ws, r++, ['Store','Cash Sales (Expected)','Cash Collected','Short / Over','Status','','','','',''], COLORS.tealGreen);
  const crStart = r;
  (storeRows || []).forEach(st => {
    const expected = (rawSales || []).filter(x => x.store_id === st.id).reduce((a, x) => a + (x.cash_sales || 0), 0);
    const collected = (rawCash || []).filter(x => x.store_id === st.id).reduce((a, x) => a + (x.cash_collected || 0), 0);
    const diff = collected - expected;
    let status = 'Pending';
    if (collected > 0) {
      if (Math.abs(diff) < 0.01) status = 'OK';
      else if (diff > 0) status = 'Over';
      else status = 'Short';
    }
    ws.getCell(r, 1).value = st.name;
    ws.getCell(r, 1).alignment = { horizontal: 'left', indent: 1 };
    ws.getCell(r, 2).value = expected;
    ws.getCell(r, 2).numFmt = FMT.money;
    ws.getCell(r, 2).alignment = { horizontal: 'right' };
    ws.getCell(r, 3).value = collected;
    ws.getCell(r, 3).numFmt = FMT.money;
    ws.getCell(r, 3).alignment = { horizontal: 'right' };
    ws.getCell(r, 4).value = diff;
    ws.getCell(r, 4).numFmt = FMT.moneyNeg;
    ws.getCell(r, 4).alignment = { horizontal: 'right' };
    const statusCell = ws.getCell(r, 5);
    statusCell.value = status;
    statusCell.alignment = { horizontal: 'center', vertical: 'middle' };
    if (status === 'Pending') {
      statusCell.fill = fill(COLORS.amberBg);
      statusCell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FF' + COLORS.amberText } };
    } else if (status === 'OK') {
      statusCell.fill = fill(COLORS.greenBg);
      statusCell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FF' + COLORS.greenText } };
    } else {
      statusCell.fill = fill(COLORS.redBg);
      statusCell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FF' + COLORS.redText } };
    }
    r++;
  });
  const crEnd = r - 1;
  if (storeRows?.length) {
    zebra(ws, crStart, crEnd, 1, 4);
    totalRow(ws, r, [
      'TOTAL',
      { formula: `SUM(B${crStart}:B${crEnd})`, result: 0 },
      { formula: `SUM(C${crStart}:C${crEnd})`, result: 0 },
      { formula: `C${r}-B${r}`, result: 0 },
      '',
      '','','','','',
    ], COLORS.tealGreen);
    for (let c = 2; c <= 3; c++) ws.getCell(r, c).numFmt = FMT.money;
    ws.getCell(r, 4).numFmt = FMT.moneyNeg;
    r++;
  }
}

// ─── Detail sheet builders ──────────────────────────────────────────

function stylizeDetailSheet(ws, headers, headerBg, firstDataRow, lastDataRow, currencyCols = [], intCols = []) {
  // Header row
  headers.forEach((h, i) => {
    const cell = ws.getCell(1, i + 1);
    cell.value = h;
    cell.fill = fill(headerBg);
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: i === 0 ? 'left' : 'right', vertical: 'middle' };
    cell.border = thinBorder();
  });
  ws.getRow(1).height = 26;
  // Zebra + formats
  for (let r = firstDataRow; r <= lastDataRow; r++) {
    const isEven = (r - firstDataRow) % 2 === 1;
    const color = isEven ? COLORS.bgLight : COLORS.white;
    for (let c = 1; c <= headers.length; c++) {
      const cell = ws.getCell(r, c);
      cell.fill = fill(color);
      cell.border = thinBorder();
      cell.font = { name: FONT, size: 10 };
      cell.alignment = { horizontal: c === 1 ? 'left' : 'right', indent: c === 1 ? 1 : 0 };
      if (currencyCols.includes(c)) cell.numFmt = FMT.money;
      if (intCols.includes(c))      cell.numFmt = FMT.int;
    }
  }
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
}

function buildDailySales(wb, bundle) {
  const ws = wb.addWorksheet('Daily Sales');
  const headers = ['Date','Store','Cash Sales','Card Sales','CashApp/Check','Total Sales','Credits','Tax','Entered By'];
  const widths = [14, 28, 14, 14, 16, 14, 12, 12, 20];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const rows = [...(bundle.rawSales || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  rows.forEach((s, idx) => {
    const r = idx + 2;
    ws.getCell(r, 1).value = s.date;
    ws.getCell(r, 2).value = bundle.stores?.find(st => st.id === s.store_id)?.name || '';
    ws.getCell(r, 3).value = Number(s.cash_sales || 0);
    ws.getCell(r, 4).value = Number(s.card_sales || 0);
    ws.getCell(r, 5).value = Number(s.cashapp_check || 0);
    ws.getCell(r, 6).value = Number(s.total_sales || 0);
    ws.getCell(r, 7).value = Number(s.credits || 0);
    ws.getCell(r, 8).value = Number(s.tax_collected || 0);
    ws.getCell(r, 9).value = s.entered_by || '';
  });
  stylizeDetailSheet(ws, headers, COLORS.teal, 2, rows.length + 1, [3, 4, 5, 6, 7, 8]);
}

function buildPurchaseDetails(wb, bundle) {
  const ws = wb.addWorksheet('Purchase Details');
  const headers = ['Week','Store','Item','Vendor','Quantity','Unit Cost','Total Cost'];
  const widths = [14, 28, 36, 22, 10, 14, 14];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const rows = [...(bundle.rawPurch || [])].sort((a, b) => (b.week_of || '').localeCompare(a.week_of || ''));
  rows.forEach((p, idx) => {
    const r = idx + 2;
    ws.getCell(r, 1).value = p.week_of || '';
    ws.getCell(r, 2).value = bundle.stores?.find(st => st.id === p.store_id)?.name || '';
    ws.getCell(r, 3).value = p.item || '';
    ws.getCell(r, 4).value = p.supplier || '';
    ws.getCell(r, 5).value = Number(p.quantity || 0);
    ws.getCell(r, 6).value = Number(p.unit_cost || 0);
    ws.getCell(r, 7).value = Number(p.total_cost || 0);
  });
  stylizeDetailSheet(ws, headers, COLORS.orange, 2, rows.length + 1, [6, 7], [5]);
}

function buildExpenseDetails(wb, bundle) {
  const ws = wb.addWorksheet('Expense Details');
  const headers = ['Month','Store','Category','Amount','Note'];
  const widths = [12, 28, 22, 14, 40];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const rows = [...(bundle.rawExp || [])].sort((a, b) => (b.month || '').localeCompare(a.month || ''));
  rows.forEach((e, idx) => {
    const r = idx + 2;
    ws.getCell(r, 1).value = e.month || '';
    ws.getCell(r, 2).value = bundle.stores?.find(st => st.id === e.store_id)?.name || '';
    ws.getCell(r, 3).value = bundle.expenseCategories?.find(c => c.id === e.category)?.label || e.category || '';
    ws.getCell(r, 4).value = Number(e.amount || 0);
    ws.getCell(r, 5).value = e.note || '';
  });
  stylizeDetailSheet(ws, headers, COLORS.purple, 2, rows.length + 1, [4]);
}

function buildCashCollections(wb, bundle) {
  const ws = wb.addWorksheet('Cash Collections');
  const headers = ['Date','Store','Cash Collected','Note'];
  const widths = [14, 28, 16, 40];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const rows = [...(bundle.rawCash || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  rows.forEach((c, idx) => {
    const r = idx + 2;
    ws.getCell(r, 1).value = c.date || '';
    ws.getCell(r, 2).value = bundle.stores?.find(st => st.id === c.store_id)?.name || '';
    ws.getCell(r, 3).value = Number(c.cash_collected || 0);
    ws.getCell(r, 4).value = c.note || '';
  });
  stylizeDetailSheet(ws, headers, COLORS.tealGreen, 2, rows.length + 1, [3]);
}

// ─── Public entrypoint ─────────────────────────────────────────────

export async function generateStyledPLReport(bundle, range) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = '7S Stores';
  wb.lastModifiedBy = '7S Stores';
  wb.created = new Date();
  wb.modified = new Date();

  buildDashboard(wb, bundle, range);
  buildDailySales(wb, bundle);
  buildPurchaseDetails(wb, bundle);
  buildExpenseDetails(wb, bundle);
  buildCashCollections(wb, bundle);

  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}
