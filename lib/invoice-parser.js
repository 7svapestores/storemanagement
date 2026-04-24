/**
 * Invoice PDF parser.
 *
 * Extracts structured line items from vendor PDFs so they can be
 * persisted into products + product_prices for price comparison.
 *
 * Returns a uniform shape regardless of which vendor template matched:
 *   { header: { vendor_name, invoice_number, invoice_date, grand_total, ... },
 *     items:  [{ upc, description, quantity, sold_unit_price, unit_price,
 *                line_discount, amount, brand, variant }] }
 *
 * Add a new parser by: write parseX(text), then register the detector below.
 */

const parseMoney = (s) => {
  if (s == null) return 0;
  const n = Number(String(s).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// "17 Jan 25" or "23 Jan 26" → ISO date (yyyy-mm-dd).
function parseShortDate(s) {
  const m = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})/.exec(s);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const mon = MONTHS[m[2].toLowerCase()];
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  if (mon == null) return null;
  return new Date(Date.UTC(year, mon, day)).toISOString().slice(0, 10);
}

// "04/10/2026" → ISO.
function parseMmDdYyyy(s) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (!m) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

// Best-effort brand/variant split.
// "FOGER SWITCH PRO 5% DISPOSABLE POD 5PK (Berry Bliss)" → brand=FOGER, variant=Berry Bliss
// "HALF BAKD D9 SUMO ... | WILD WATERMELON"             → variant=WILD WATERMELON
function splitNameParts(description) {
  const parens = /\(([^)]+)\)\s*$/.exec(description);
  if (parens) {
    return { name: description.slice(0, parens.index).trim(), variant: parens[1].trim() };
  }
  const pipe = description.lastIndexOf('|');
  if (pipe > 0) {
    return { name: description.slice(0, pipe).trim(), variant: description.slice(pipe + 1).trim() };
  }
  return { name: description.trim(), variant: null };
}

// ───────────────────────── Rave Distribution ─────────────────────────
// pdf-parse reads Rave's columnar layout in this (surprising) order:
//   <digits>$<sold>$<tax>$<amount><description>
// where <digits> concatenates: line-number, optional customer id, UPC, qty
// with NO separators. We split the digit prefix by trying plausible
// (upcLen, qtyLen) combos and verifying qty × sold ≈ amount.
function parseRave(text) {
  const header = {
    vendor_name: 'Rave Distribution',
    parse_source: 'rave',
    invoice_number: /INVOICE\s*:\s*(\d+)/i.exec(text)?.[1] || null,
    invoice_date:  parseShortDate(/Date:\s*([\d]{1,2}\s+[A-Za-z]{3}\s+\d{2,4})/i.exec(text)?.[1] || ''),
    subtotal:       parseMoney(/Subtotal\s*\$?([\d,.]+)/i.exec(text)?.[1]),
    total_discount: parseMoney(/Total\s*Discount\s*\$?([\d,.]+)/i.exec(text)?.[1]),
    grand_total:    parseMoney(/Grand\s*Total\s*\$?([\d,.]+)/i.exec(text)?.[1]),
  };

  // Flatten newlines into spaces so wrapped descriptions stay with their row.
  const flat = text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();

  // Isolate the item region: between the column-header row and the totals.
  let region = flat;
  const startMatch = region.match(/UPC\s*Product\s*Name\s*\/?\s*Description\s*Qty\s*Sold\s*Price\s*Tax\s*Amount/i);
  if (startMatch) region = region.slice(startMatch.index + startMatch[0].length);
  const endMatch = region.match(/\bTotal\s*Quantity|\bSubtotal\s*\$/i);
  if (endMatch) region = region.slice(0, endMatch.index);
  region = region.trim();

  // Each row starts with a concatenated digit block, then three $money tokens,
  // then description text (which may include spaces / wrap continuations).
  const rowRe = /(\d+)\s*\$\s*([\d,]+\.\d{2})\s*\$\s*([\d,]+\.\d{2})\s*\$\s*([\d,]+\.\d{2})/g;
  const matches = [];
  let m;
  while ((m = rowRe.exec(region)) !== null) matches.push({ m, index: m.index, end: rowRe.lastIndex });

  const items = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const digits = cur.m[1];
    const sold   = parseMoney(cur.m[2]);
    const amt    = parseMoney(cur.m[4]);

    // Split digits into (line/customer) + UPC + qty. UPC is 10–14 digits,
    // qty 1–3 digits, everything else is line/customer prefix (1–6 digits).
    let split = null;
    outer: for (const qtyLen of [1, 2, 3]) {
      const qtyVal = parseInt(digits.slice(-qtyLen), 10);
      if (!qtyVal) continue;
      for (const upcLen of [12, 11, 13, 10, 14]) {
        const prefixLen = digits.length - upcLen - qtyLen;
        if (prefixLen < 1 || prefixLen > 6) continue;
        const upc = digits.slice(prefixLen, prefixLen + upcLen);
        // Math check: qty × sold should be within 35% of amount (accounts for
        // line discount). When sold is 0 we can't verify — accept the split.
        if (sold > 0) {
          const err = Math.abs(qtyVal * sold - amt) / (qtyVal * sold);
          if (err > 0.35) continue;
        }
        split = { upc, qty: qtyVal };
        break outer;
      }
    }
    // Fallback: last-digit qty, prior 12 digits = UPC.
    if (!split && digits.length >= 13) {
      split = {
        upc: digits.slice(digits.length - 13, digits.length - 1),
        qty: parseInt(digits.slice(-1), 10) || 1,
      };
    }
    if (!split) continue;

    // Description = text after this row's tail, until the next row begins
    // (or until end of region).
    const descStart = cur.end;
    const descEnd = (i + 1 < matches.length) ? matches[i + 1].index : region.length;
    let desc = region.slice(descStart, descEnd).trim();
    desc = desc.replace(/\s+/g, ' ');
    // Strip Rave's duplicated-description artifact (same text repeated).
    if (desc.length >= 10) {
      const mid = Math.floor(desc.length / 2);
      const a = desc.slice(0, mid).trim();
      const b = desc.slice(-a.length).trim();
      if (a && a === b) desc = a;
    }

    items.push({
      upc: split.upc,
      description: desc,
      quantity: split.qty,
      sold_unit_price: sold,
      amount: amt,
      unit_price: split.qty > 0 ? +(amt / split.qty).toFixed(4) : sold,
      line_discount: +(sold * split.qty - amt).toFixed(2),
      ...splitNameParts(desc),
    });
  }

  return { header, items };
}

// ───────────────────────── NEPA Dallas ─────────────────────────
// Line shape: <DESCRIPTION possibly wrapping> <10-14 digit barcode> <qty> <unit> $ <amount>
function parseNepa(text) {
  const header = {
    vendor_name: 'NEPA Dallas',
    parse_source: 'nepa',
    invoice_number: /Invoice\s+(INV[\w/]+)/i.exec(text)?.[1] || null,
    invoice_date:   parseMmDdYyyy(/Invoice Date\s*(\d{2}\/\d{2}\/\d{4})/i.exec(text)?.[1] || ''),
    subtotal:       parseMoney(/Untaxed\s*Amount\s*\$?\s*([\d,.]+)/i.exec(text)?.[1]),
    total_discount: 0,
    grand_total:    parseMoney(/\bTotal\s*\$\s*([\d,.]+)/i.exec(text)?.[1]),
  };

  // Flatten whitespace, then isolate only the item-table region.
  // NEPA's PDF reliably prints "Description Barcode Quantity Unit Price Taxes Amount"
  // as the column-header row; items follow until "Untaxed Amount" or "Total".
  const flat = text.replace(/\s+/g, ' ');
  const tableParts = flat.split(/Description\s+Barcode\s+Quantity\s+Unit\s+Price\s+Taxes?\s+Amount/i);
  const items = [];
  // Walk every section that came after a column-header row (handles multi-page PDFs).
  for (let p = 1; p < tableParts.length; p++) {
    let region = tableParts[p];
    // Cut off the footer / next boilerplate.
    region = region.split(/(Untaxed\s*Amount|Payment\s+Communication|INV\/DAL|Page\s+\d)/i)[0];

    // Walk row-by-row: barcode + qty + unit + $ + amount. Description is the
    // text BEFORE the barcode (from the previous row's end), minus stray tokens.
    const rowRe = /(\d{10,14})\s+(\d+(?:\.\d+)?)\s+([\d.]+)\s+\$\s*([\d,.]+)/g;
    let prev = 0;
    let m;
    while ((m = rowRe.exec(region)) !== null) {
      const barcode   = m[1];
      const qty       = parseFloat(m[2]);
      const unitPrice = parseMoney(m[3]);
      const amount    = parseMoney(m[4]);
      if (Math.abs(qty * unitPrice - amount) > 0.5) { prev = rowRe.lastIndex; continue; }

      let desc = region.slice(prev, m.index).trim();
      prev = rowRe.lastIndex;

      // Strip leading header / page boilerplate that can appear on new pages.
      desc = desc.replace(/^.*?(?=[A-Z][A-Za-z0-9])/, '');
      desc = desc.replace(/\bNEPA\s+DALLAS\s+LLC\b.*$/i, '').trim();
      if (!desc) continue;
      if (/^(Total|Untaxed|Amount|Description)/i.test(desc)) continue;

      const parens = /\(([^)]+)\)\s*$/.exec(desc);
      const variant = parens ? parens[1].trim() : null;
      const name = parens ? desc.slice(0, parens.index).trim() : desc;

      items.push({
        upc: barcode,
        description: desc,
        quantity: qty,
        sold_unit_price: unitPrice,
        amount,
        unit_price: unitPrice,
        line_discount: 0,
        name,
        variant,
      });
    }
  }

  return { header, items };
}

// ───────────────────────── Entry points ─────────────────────────

function detectAndParse(text) {
  if (/Rave\s*Distribution/i.test(text))     return parseRave(text);
  if (/NEPA\s*DALLAS\s*LLC/i.test(text))     return parseNepa(text);
  const err = new Error('Unrecognized invoice format. Supported: Rave Distribution, NEPA Dallas.');
  err.code = 'UNKNOWN_FORMAT';
  throw err;
}

async function extractPdfText(buffer) {
  // pdf-parse v1: import the lib file directly to skip the debug-time
  // test-fixture read that happens when requiring the package root.
  const pdf = require('pdf-parse/lib/pdf-parse.js');
  const { text } = await pdf(buffer);
  return text;
}

async function parsePdfBuffer(buffer) {
  const text = await extractPdfText(buffer);
  return { ...detectAndParse(text), raw_text: text };
}

module.exports = {
  parsePdfBuffer,
  extractPdfText,
  detectAndParse,
  parseRave,
  parseNepa,
  splitNameParts,
};
