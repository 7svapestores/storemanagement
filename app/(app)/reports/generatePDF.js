import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const $ = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => `${Number(n || 0).toFixed(1)}%`;
const COLORS = {
  primary: [16, 185, 129],
  blue: [59, 130, 246],
  red: [239, 68, 68],
  amber: [245, 158, 11],
  green: [34, 197, 94],
  purple: [168, 85, 247],
  text: [31, 41, 55],
  muted: [107, 114, 128],
  bg: [249, 250, 251],
  white: [255, 255, 255],
  dark: [15, 23, 42],
};

function headerFooter(doc, range, pageNum) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text(`7S Stores | Business Report | ${range.start} to ${range.end}`, 20, 10);
  doc.text(`Page ${pageNum}`, w - 20, h - 8, { align: 'right' });
  doc.text('Confidential — For ownership team only', 20, h - 8);
}

function drawStatBox(doc, x, y, w, h, label, value, color, sub) {
  doc.setFillColor(...(color || COLORS.bg));
  doc.roundedRect(x, y, w, h, 3, 3, 'F');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.muted);
  doc.text(label.toUpperCase(), x + w / 2, y + 10, { align: 'center' });
  doc.setFontSize(18);
  doc.setTextColor(...COLORS.text);
  doc.setFont('helvetica', 'bold');
  doc.text(value, x + w / 2, y + 22, { align: 'center' });
  if (sub) {
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.text(sub, x + w / 2, y + 29, { align: 'center' });
  }
  doc.setFont('helvetica', 'normal');
}

function drawBar(doc, x, y, maxW, h, pctFill, color, label, amount) {
  doc.setFillColor(230, 230, 230);
  doc.rect(x, y, maxW, h, 'F');
  doc.setFillColor(...color);
  doc.rect(x, y, maxW * Math.min(1, pctFill), h, 'F');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.text);
  doc.text(label, x - 2, y + h / 2 + 2, { align: 'right' });
  doc.text(amount, x + maxW + 3, y + h / 2 + 2);
}

export function generatePDF({ summary, storeRows, expenseRows, byVendor, dailyTrend, trendStats, cashRecon, insights, watchouts, rawSales, rawPurch, rawExp, stores }, range) {
  const doc = new jsPDF('p', 'mm', 'letter');
  const W = doc.internal.pageSize.getWidth();
  let page = 0;

  // ── PAGE 1: COVER ──
  page++;
  doc.setFillColor(16, 185, 129);
  doc.rect(0, 0, W, 50, 'F');
  doc.setFillColor(13, 148, 103);
  doc.rect(0, 45, W, 5, 'F');
  doc.setFontSize(28);
  doc.setTextColor(...COLORS.white);
  doc.setFont('helvetica', 'bold');
  doc.text('7S STORES', W / 2, 22, { align: 'center' });
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.text('Business Performance Report', W / 2, 32, { align: 'center' });
  doc.setFontSize(11);
  doc.text(`${range.start}  to  ${range.end}`, W / 2, 42, { align: 'center' });

  doc.setTextColor(...COLORS.text);
  doc.setFontSize(11);
  doc.text('Prepared for: Ownership Team', W / 2, 70, { align: 'center' });
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.muted);
  doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, W / 2, 78, { align: 'center' });

  // Store chips
  const storeColors = {};
  (stores || []).forEach(s => { storeColors[s.id] = s.color; });
  let chipX = 40;
  doc.setFontSize(10);
  (storeRows || []).forEach((s, i) => {
    const c = hexToRgb(s.color) || COLORS.muted;
    doc.setFillColor(...c);
    doc.circle(chipX, 100, 3, 'F');
    doc.setTextColor(...COLORS.text);
    doc.text(s.name, chipX + 6, 102);
    chipX += 42;
    if (i === 2) { chipX = 60; doc.setFontSize(10); }
  });

  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text('Confidential — For ownership team only', W / 2, 270, { align: 'center' });

  // ── PAGE 2: EXECUTIVE SUMMARY ──
  doc.addPage();
  page++;
  headerFooter(doc, range, page);

  doc.setFontSize(16);
  doc.setTextColor(...COLORS.text);
  doc.setFont('helvetica', 'bold');
  doc.text('Executive Summary', 20, 22);
  doc.setFont('helvetica', 'normal');

  if (summary) {
    const bw = 52, bh = 34, gap = 5, startX = 20;
    drawStatBox(doc, startX, 30, bw, bh, 'Revenue', $(summary.totalRevenue), [220, 252, 231]);
    drawStatBox(doc, startX + bw + gap, 30, bw, bh, 'COGS', $(summary.totalPurchases), [254, 249, 195]);
    drawStatBox(doc, startX + (bw + gap) * 2, 30, bw, bh, 'Expenses', $(summary.totalExpenses), [254, 226, 226]);
    drawStatBox(doc, startX + 26, 30 + bh + gap, bw, bh, 'Net Profit', $(summary.netProfit), summary.netProfit >= 0 ? [220, 252, 231] : [254, 226, 226]);
    drawStatBox(doc, startX + 26 + bw + gap, 30 + bh + gap, bw, bh, 'Margin', pct(summary.margin), [219, 234, 254], summary.revenueChange != null ? `${summary.revenueChange >= 0 ? '↑' : '↓'} ${Math.abs(summary.revenueChange).toFixed(1)}% vs prev` : '');

    // P&L Waterfall
    let wy = 115;
    doc.setFontSize(12);
    doc.setTextColor(...COLORS.text);
    doc.setFont('helvetica', 'bold');
    doc.text('P&L Waterfall', 20, wy);
    doc.setFont('helvetica', 'normal');
    wy += 8;
    const maxBar = 120;
    const rev = summary.totalRevenue || 1;
    const lines = [
      { label: 'Revenue', val: summary.totalRevenue, color: COLORS.green },
      { label: 'COGS', val: summary.totalPurchases, color: COLORS.amber },
      { label: 'Gross Profit', val: summary.grossProfit, color: COLORS.green },
      { label: 'Expenses', val: summary.totalExpenses, color: COLORS.red },
      { label: 'Net Profit', val: summary.netProfit, color: summary.netProfit >= 0 ? COLORS.green : COLORS.red },
    ];
    lines.forEach(l => {
      doc.setFontSize(9);
      doc.setTextColor(...COLORS.text);
      doc.text(l.label, 55, wy + 4, { align: 'right' });
      doc.setFillColor(235, 235, 235);
      doc.rect(60, wy, maxBar, 6, 'F');
      doc.setFillColor(...l.color);
      doc.rect(60, wy, maxBar * Math.min(1, Math.abs(l.val) / rev), 6, 'F');
      doc.text($(l.val), 60 + maxBar + 3, wy + 4);
      wy += 10;
    });

    // Key Insights
    if (insights?.length) {
      wy += 10;
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Key Takeaways', 20, wy);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      wy += 7;
      insights.slice(0, 5).forEach(ins => {
        const icon = ins.type === 'good' ? '✓' : ins.type === 'bad' ? '✗' : ins.type === 'warn' ? '!' : '→';
        doc.setTextColor(...(ins.type === 'good' ? COLORS.green : ins.type === 'bad' ? COLORS.red : ins.type === 'warn' ? COLORS.amber : COLORS.blue));
        doc.text(icon, 22, wy);
        doc.setTextColor(...COLORS.text);
        doc.text(ins.text, 28, wy);
        wy += 6;
      });
    }
  }

  // ── PAGE 3: STORE PERFORMANCE ──
  doc.addPage();
  page++;
  headerFooter(doc, range, page);
  doc.setFontSize(16);
  doc.setTextColor(...COLORS.text);
  doc.setFont('helvetica', 'bold');
  doc.text('Store Performance', 20, 22);
  doc.setFont('helvetica', 'normal');

  if (storeRows?.length) {
    autoTable(doc, {
      startY: 28,
      head: [['#', 'Store', 'Revenue', 'COGS', 'Expenses', 'Profit', 'Margin']],
      body: storeRows.map((s, i) => [
        i === 0 ? '🏆' : String(i + 1),
        s.name, $(s.revenue), $(s.purchases), $(s.expenses), $(s.net), pct(s.margin),
      ]),
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center' },
        2: { halign: 'right', font: 'courier' },
        3: { halign: 'right', font: 'courier' },
        4: { halign: 'right', font: 'courier' },
        5: { halign: 'right', font: 'courier' },
        6: { halign: 'right' },
      },
    });

    // Revenue bars
    let by = (doc.lastAutoTable?.finalY || 100) + 15;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Revenue by Store', 20, by);
    doc.setFont('helvetica', 'normal');
    by += 8;
    const maxRev = Math.max(1, ...storeRows.map(s => s.revenue));
    storeRows.forEach(s => {
      const c = hexToRgb(s.color) || COLORS.blue;
      drawBar(doc, 55, by, 100, 5, s.revenue / maxRev, c, s.name.split(' - ').pop()?.trim() || s.name, $(s.revenue));
      by += 9;
    });
  }

  // ── PAGE 4: EXPENSES ──
  doc.addPage();
  page++;
  headerFooter(doc, range, page);
  doc.setFontSize(16);
  doc.setTextColor(...COLORS.text);
  doc.setFont('helvetica', 'bold');
  doc.text('Cost Analysis', 20, 22);
  doc.setFont('helvetica', 'normal');

  if (expenseRows?.length) {
    autoTable(doc, {
      startY: 28,
      head: [['Category', 'This Period', 'Previous', 'Change']],
      body: expenseRows.map(r => [
        `${r.icon} ${r.label}`, $(r.current), $(r.previous),
        r.previous > 0 ? `${r.change > 0 ? '↑' : '↓'} ${Math.abs(r.change).toFixed(1)}%` : '—',
      ]),
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
      columnStyles: { 1: { halign: 'right', font: 'courier' }, 2: { halign: 'right', font: 'courier' }, 3: { halign: 'right' } },
    });
  }

  if (byVendor?.length) {
    let vy = (doc.lastAutoTable?.finalY || 28) + 15;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Top Vendors (COGS)', 20, vy);
    doc.setFont('helvetica', 'normal');

    autoTable(doc, {
      startY: vy + 5,
      head: [['Vendor', 'Amount', '% of Total']],
      body: byVendor.slice(0, 10).map(v => {
        const total = summary?.totalPurchases || 1;
        return [v.name, $(v.total), pct((v.total / total) * 100)];
      }),
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
      columnStyles: { 1: { halign: 'right', font: 'courier' }, 2: { halign: 'right' } },
    });
  }

  // ── PAGES 5-9: INDIVIDUAL STORES ──
  (storeRows || []).forEach((s, idx) => {
    doc.addPage();
    page++;
    headerFooter(doc, range, page);

    const c = hexToRgb(s.color) || COLORS.blue;
    doc.setFillColor(...c);
    doc.rect(0, 14, W, 8, 'F');
    doc.setFontSize(14);
    doc.setTextColor(...COLORS.white);
    doc.setFont('helvetica', 'bold');
    doc.text(s.name, W / 2, 20, { align: 'center' });
    doc.setFont('helvetica', 'normal');

    const bw = 32, bh = 28;
    drawStatBox(doc, 20, 28, bw, bh, 'Revenue', $(s.revenue), [220, 252, 231]);
    drawStatBox(doc, 20 + bw + 4, 28, bw, bh, 'COGS', $(s.purchases), [254, 249, 195]);
    drawStatBox(doc, 20 + (bw + 4) * 2, 28, bw, bh, 'Expenses', $(s.expenses), [254, 226, 226]);
    drawStatBox(doc, 20 + (bw + 4) * 3, 28, bw, bh, 'Profit', $(s.net), s.net >= 0 ? [220, 252, 231] : [254, 226, 226]);
    drawStatBox(doc, 20 + (bw + 4) * 4, 28, bw, bh, 'Margin', pct(s.margin), [219, 234, 254]);

    // Store P&L
    let sy = 65;
    doc.setFontSize(10);
    const stLines = [
      ['Revenue', $(s.revenue)],
      ['− COGS', $(s.purchases)],
      ['= Gross Profit', $(s.revenue - s.purchases)],
      ['− Expenses', $(s.expenses)],
      ['= Net Profit', $(s.net)],
    ];
    stLines.forEach(([label, val]) => {
      doc.setTextColor(...COLORS.muted);
      doc.text(label, 25, sy);
      doc.setTextColor(...COLORS.text);
      doc.setFont('courier', 'normal');
      doc.text(val, 100, sy, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      sy += 6;
    });

    // Top expenses for this store
    const stExp = (rawExp || []).filter(r => r.store_id === s.id);
    const stExpByCat = {};
    stExp.forEach(r => { stExpByCat[r.category] = (stExpByCat[r.category] || 0) + (r.amount || 0); });
    const stCats = Object.entries(stExpByCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (stCats.length) {
      sy += 8;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.text);
      doc.text('Top Expenses', 20, sy);
      doc.setFont('helvetica', 'normal');
      sy += 5;
      autoTable(doc, {
        startY: sy,
        head: [['Category', 'Amount']],
        body: stCats.map(([cat, amt]) => [cat, $(amt)]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [...c], textColor: [255, 255, 255] },
        columnStyles: { 1: { halign: 'right', font: 'courier' } },
        margin: { left: 20 },
        tableWidth: 80,
      });
    }

    // Top vendors for this store
    const stPurch = (rawPurch || []).filter(r => r.store_id === s.id);
    const stVendMap = {};
    stPurch.forEach(r => { stVendMap[r.supplier || 'Unknown'] = (stVendMap[r.supplier || 'Unknown'] || 0) + (r.total_cost || r.unit_cost || 0); });
    const stVends = Object.entries(stVendMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (stVends.length) {
      const vy2 = (doc.lastAutoTable?.finalY || sy) + 10;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('Top Vendors', 20, vy2);
      doc.setFont('helvetica', 'normal');
      autoTable(doc, {
        startY: vy2 + 5,
        head: [['Vendor', 'Amount']],
        body: stVends.map(([v, amt]) => [v, $(amt)]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [...c], textColor: [255, 255, 255] },
        columnStyles: { 1: { halign: 'right', font: 'courier' } },
        margin: { left: 20 },
        tableWidth: 80,
      });
    }
  });

  // ── LAST PAGE: WATCHOUTS ──
  doc.addPage();
  page++;
  headerFooter(doc, range, page);
  doc.setFontSize(16);
  doc.setTextColor(...COLORS.text);
  doc.setFont('helvetica', 'bold');
  doc.text('Watchouts & Action Items', 20, 22);
  doc.setFont('helvetica', 'normal');

  let wy = 30;
  if (watchouts?.length) {
    watchouts.forEach(w => {
      doc.setFillColor(...(w.sev === 'red' ? [254, 226, 226] : [254, 249, 195]));
      doc.roundedRect(20, wy, W - 40, 12, 2, 2, 'F');
      doc.setFontSize(9);
      doc.setTextColor(...(w.sev === 'red' ? COLORS.red : COLORS.amber));
      doc.text(w.sev === 'red' ? 'URGENT' : 'MONITOR', 24, wy + 7);
      doc.setTextColor(...COLORS.text);
      doc.text(w.text, 50, wy + 7);
      wy += 16;
    });
  } else {
    doc.setFillColor(220, 252, 231);
    doc.roundedRect(20, wy, W - 40, 20, 3, 3, 'F');
    doc.setFontSize(12);
    doc.setTextColor(...COLORS.green);
    doc.text('All metrics look healthy — no watchouts this period', W / 2, wy + 12, { align: 'center' });
  }

  // Appendix note
  wy += 25;
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text('Report generated from live data. Sources: NRS POS (7S Agent), manual entries.', 20, wy);
  doc.text('COGS = Cost of Goods Sold (product purchases). Gross Profit = Revenue - COGS. Net Profit = Gross Profit - Expenses.', 20, wy + 5);
  doc.text(`Generated on ${new Date().toLocaleString('en-US')} | Total pages: ${page}`, 20, wy + 10);

  return doc;
}

function hexToRgb(hex) {
  if (!hex) return null;
  const h = hex.replace('#', '');
  if (h.length !== 6) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
