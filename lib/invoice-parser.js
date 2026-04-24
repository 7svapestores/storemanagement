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
// pdf-parse reads NEPA rows as:
//   <description><barcode><qty.00><unit.00>$ <amount>
// all concatenated. Summary blocks (Untaxed Amount / Total / Credit Card /
// Paid on / Amount Due) and page-footer boilerplate can also appear between
// items because of how the PDF's columns are positioned.
//
// Strategy: flatten the text, anchor on the barcode+qty+unit+$amount tail,
// take everything between the previous anchor and this one as the candidate
// description, and scrub known boilerplate phrases.
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

  const flat = text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();

  // Strip phrases that show up mid-region and pollute descriptions.
  const scrubDesc = (raw) => {
    let s = raw;
    // Invoice header preamble (only appears before the first item).
    s = s.replace(/Bill\s*To:[\s\S]*?Responsible\s*Name:?\s*[A-Z][a-zA-Z]*\s+[A-Z][a-zA-Z]*/gi, ' ');
    // Page-footer block: "NEPA DALLAS LLC ... UNITED STATES" reappears between
    // items on page breaks; scrub the whole block at once.
    s = s.replace(/NEPA\s+DALLAS\s+LLC[\s\S]*?UNITED\s+STATES/gi, ' ');
    s = s.replace(/NEPA\s+DALLAS\s+LLC/gi, ' ');
    s = s.replace(/FARMERS\s+BRANCH\s+TX\s+\d+/gi, ' ');
    s = s.replace(/UNITED\s+STATES/gi, ' ');
    // Column header (per page).
    s = s.replace(/Description\s*Barcode\s*Quantity\s*Unit\s*Price\s*Taxes?\s*Amount/gi, ' ');
    // Page numbers and invoice refs.
    s = s.replace(/Page\s+\d+\s*\/\s*\d+/gi, ' ');
    s = s.replace(/INV\/DAL\/\d+\/\d+/gi, ' ');
    s = s.replace(/Payment\s+Communication:/gi, ' ');
    // End-of-invoice totals block.
    s = s.replace(/Untaxed\s*Amount\s*\$?\s*[\d,.]+/gi, ' ');
    s = s.replace(/\bTotal\s*\$\s*[\d,.]+/gi, ' ');
    s = s.replace(/Credit\s*Card\s*Paid\s*on\s*\d{2}\/\d{2}\/\d{4}\s*\$?\s*[\d,.]+/gi, ' ');
    s = s.replace(/Credit\s*Card/gi, ' ');
    s = s.replace(/Paid\s*on\s*\d{2}\/\d{2}\/\d{4}/gi, ' ');
    s = s.replace(/\bAmount\s*Due\b/gi, ' ');
    s = s.replace(/\$\s*[\d,.]+/g, ' ');          // stray money tokens
    // Collapse whitespace.
    s = s.replace(/\s+/g, ' ').trim();
    // Final pass: if the scrubbed text still has junk before the real product
    // name, keep only the last ALL-CAPS-to-(variant) phrase.
    const tail = /[A-Z][A-Z0-9%&+\-.'/,\s]*\([^)]+\)\s*$/.exec(s);
    if (tail && tail[0].length >= 8 && tail[0].length <= 180) {
      s = tail[0].trim();
    }
    return s;
  };

  // Row tail: 12–14 digit barcode, then qty (X.XX), then unit price (X.XX),
  // then "$<space?><amount>".
  const rowRe = /(\d{12,14})(\d+\.\d{2})(\d+\.\d{2})\s*\$\s*([\d,]+\.\d{2})/g;
  const items = [];
  let prevEnd = 0;
  let m;
  while ((m = rowRe.exec(flat)) !== null) {
    const barcode   = m[1];
    const qty       = parseFloat(m[2]);
    const unitPrice = parseFloat(m[3]);
    const amount    = parseMoney(m[4]);
    // Sanity: line math must match (allow 1¢ rounding slop).
    if (Math.abs(qty * unitPrice - amount) > 0.5) { prevEnd = rowRe.lastIndex; continue; }

    let desc = scrubDesc(flat.slice(prevEnd, m.index));
    prevEnd = rowRe.lastIndex;
    if (!desc) continue;

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
