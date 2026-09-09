// Grouping the same product across five stores.
//
// NRS keys every pricebook item by UPC — it is the only field guaranteed to
// be identical in all five stores, because it comes off the manufacturer's
// box rather than from whoever typed the item in. Names are what make the
// result readable, but they drift store to store ("GEEKBAR PULSE 15K" vs
// "Geek Bar Pulse"), so they can never be the key.
//
// Two levels of grouping:
//   1. One UPC, five stores  → a `row` with a price per store.
//   2. Rows sharing a UPC prefix → a `family` (Geekbar Pulse and its flavors),
//      because manufacturers vary only the last digits per flavor/variant.
//
// The number of trailing digits that encode the flavor differs by vendor, so
// it is detected from the data rather than hard-coded, and the caller can
// override it.

// Uppercase, drop punctuation, collapse runs of whitespace. Used for every
// name comparison so "Geek-Bar  Pulse" and "GEEK BAR PULSE" line up.
export function normalizeName(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

const tokens = (name) => normalizeName(name).split(' ').filter(Boolean);

// Collapse one store's search hits into rows keyed by UPC.
// `perStore` is [{ store: {id, name}, items: [...] }].
export function buildRows(perStore) {
  const byUpc = new Map();

  for (const { store, items } of perStore) {
    for (const item of items || []) {
      const upc = String(item.upc || item.upcorplu || '').trim();
      if (!upc) continue;
      if (!byUpc.has(upc)) byUpc.set(upc, { upc, names: {}, prices: {}, costs: {} });
      const row = byUpc.get(upc);
      row.names[store.id] = item.name || item.desc || '';
      row.prices[store.id] = Number.isFinite(item.cents) ? item.cents : null;
      row.costs[store.id] = Number.isFinite(item.cost_cents) ? item.cost_cents : null;
    }
  }

  return [...byUpc.values()].map((row) => ({
    ...row,
    // The name shown for the row: whichever spelling the most stores agree on.
    name: consensusName(Object.values(row.names)),
    // Stores that spell this item differently are worth surfacing — it is
    // usually a data-entry slip rather than a different product.
    nameConflict: new Set(Object.values(row.names).map(normalizeName).filter(Boolean)).size > 1,
  })).sort((a, b) => a.upc.localeCompare(b.upc));
}

// The spelling used by the most stores; ties fall to the longest, which
// usually carries the most detail ("GEEKBAR PULSE 15K" over "GEEKBAR").
export function consensusName(names) {
  const counts = new Map();
  for (const n of names) {
    if (!n) continue;
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  if (!counts.size) return '';
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
}

// A family groups UPCs that match except for their last `variantDigits`.
export function familyKey(upc, variantDigits) {
  const s = String(upc);
  if (s.length <= variantDigits) return s;
  return `${s.length}:${s.slice(0, s.length - variantDigits)}`;
}

// How many trailing digits encode the flavor? Vendors differ, so score each
// candidate on how well the resulting families agree by name: grouping items
// that share a leading name token is the signal we want, and lumping together
// items whose names have nothing in common is the mistake we are avoiding.
export function detectVariantDigits(rows, candidates = [2, 3, 4]) {
  let best = null;

  for (const digits of candidates) {
    const families = new Map();
    for (const row of rows) {
      const key = familyKey(row.upc, digits);
      if (!families.has(key)) families.set(key, []);
      families.get(key).push(row);
    }

    let score = 0, groupCount = 0;
    for (const members of families.values()) {
      if (members.length < 2) continue;
      groupCount++;
      // Every member sharing the first word is a good group; a family whose
      // members disagree on it is over-merged, so it costs more than it earns.
      const firsts = members.map(m => tokens(m.name)[0] || '');
      const agree = firsts.every(f => f && f === firsts[0]);
      score += agree ? members.length : -members.length * 2;
    }

    // When two masks group the same items equally well — which is the common
    // case, since a brand's flavor codes rarely span enough values to tell a
    // 2- from a 3-digit code apart — take the smaller one. A family split too
    // finely is something the owner can widen in the UI; a mask that merges
    // two brands quietly reprices the wrong products.
    if (!best || score > best.score) best = { digits, score, groupCount };
  }
  return best.digits;
}

// The leading words every member shares, e.g. "GEEKBAR PULSE". Empty when the
// names have no common start, in which case the caller falls back to the UPC.
export function commonNamePrefix(names) {
  const lists = names.map(tokens).filter(t => t.length);
  if (!lists.length) return '';
  const out = [];
  for (let i = 0; i < lists[0].length; i++) {
    const word = lists[0][i];
    if (!lists.every(l => l[i] === word)) break;
    out.push(word);
  }
  // A single generic first word ("VAPE") is not a product name.
  if (out.length === 1 && lists.some(l => l.length > 2)) return out.join(' ');
  return out.join(' ');
}

// What distinguishes this item inside its family — the flavor, in practice.
export function variantLabel(name, familyLabel) {
  const n = normalizeName(name);
  const f = normalizeName(familyLabel);
  if (f && n.startsWith(f)) {
    const rest = n.slice(f.length).trim();
    if (rest) return rest;
  }
  return n || '';
}

// The leading digits every UPC in a family shares.
export function commonUpcPrefix(upcs) {
  if (!upcs.length) return '';
  let prefix = String(upcs[0]);
  for (const upc of upcs.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < upc.length && prefix[i] === upc[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix;
}

// Group rows into families, each labelled and sorted for display.
export function buildFamilies(rows, { variantDigits } = {}) {
  const digits = variantDigits ?? detectVariantDigits(rows);
  const groups = new Map();

  for (const row of rows) {
    const key = familyKey(row.upc, digits);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const families = [...groups.entries()].map(([key, members]) => {
    const label = commonNamePrefix(members.map(m => m.name)) || members[0].name || '';
    // Show the digits these UPCs actually share, not the mask width used to
    // find them — "810082•••" is what the owner recognises off the box.
    const prefix = members.length > 1 ? commonUpcPrefix(members.map(m => m.upc)) : '';
    return {
      key,
      label: label || `UPC ${prefix}`,
      upcPrefix: prefix,
      variantDigits: digits,
      items: members
        .map(m => ({ ...m, variant: variantLabel(m.name, label) }))
        .sort((a, b) => a.variant.localeCompare(b.variant) || a.upc.localeCompare(b.upc)),
    };
  });

  return { variantDigits: digits, families: families.sort((a, b) => a.label.localeCompare(b.label)) };
}

// The price most stores charge for a row. Returns null when there is no clear
// majority — with nothing to call "normal", nothing can be called custom.
export function normPrice(prices) {
  const counts = new Map();
  for (const c of Object.values(prices)) {
    if (!Number.isFinite(c)) continue;
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  if (!counts.size) return null;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;
  if (ranked[0][1] < 2) return null;
  return ranked[0][0];
}

// Stores whose price differs from what most stores charge. These are the
// deliberate ones (a location that charges more), so they are protected from
// a blanket "set all" unless the owner opts them in.
export function customStores(row) {
  const norm = normPrice(row.prices);
  if (norm == null) return [];
  return Object.entries(row.prices)
    .filter(([, cents]) => Number.isFinite(cents) && cents !== norm)
    .map(([storeId]) => storeId);
}

export const SKIP_REASON = {
  NOT_CARRIED: 'not_carried',
  CUSTOM_PRICE: 'custom_price',
  ALREADY_SET: 'already_set',
};

/**
 * Work out exactly which (store, UPC) writes a requested price implies.
 *
 * Nothing is written for a store that does not carry the item, that is
 * already at the target price, or that holds a deliberate custom price —
 * unless `includeCustom` says otherwise. Every exclusion is returned with its
 * reason so the review screen can explain itself rather than silently
 * dropping stores.
 *
 * @param {object[]} rows          rows from buildRows()
 * @param {object}   opts
 *   - storeIds       stores the owner ticked
 *   - priceFor(row)  target price in cents for that row, or null to skip it
 *   - includeCustom  also overwrite stores holding a custom price
 * @returns {{ writes: object[], skipped: object[] }}
 */
export function planWrites(rows, { storeIds, priceFor, includeCustom = false }) {
  const writes = [];
  const skipped = [];

  for (const row of rows) {
    const target = priceFor(row);
    if (!Number.isInteger(target) || target < 0) continue;
    const custom = new Set(customStores(row));

    for (const storeId of storeIds) {
      const current = row.prices[storeId];
      const base = { store_id: storeId, upc: row.upc, name: row.name };

      if (!Number.isFinite(current)) {
        skipped.push({ ...base, reason: SKIP_REASON.NOT_CARRIED });
      } else if (current === target) {
        skipped.push({ ...base, reason: SKIP_REASON.ALREADY_SET, from: current });
      } else if (custom.has(storeId) && !includeCustom) {
        skipped.push({ ...base, reason: SKIP_REASON.CUSTOM_PRICE, from: current, to: target });
      } else {
        writes.push({ ...base, from: current, to: target });
      }
    }
  }

  return { writes, skipped };
}

// How many stores a blanket price change would skip for holding a custom
// price — drives the "2 stores have their own price, include them?" prompt.
export function countProtected(rows, storeIds) {
  const set = new Set(storeIds);
  let n = 0;
  for (const row of rows) n += customStores(row).filter(s => set.has(s)).length;
  return n;
}

// ── Dividing a UPC prefix by what the items currently cost ──────────────
//
// A brand's UPC block is not laid out by product. Under 81020387, Geekbar
// Pulse occupies 0100-0200 AND 0301-0500 while Pulse X sits at 0201-0300
// between them, so no single numeric range picks out one product. What does
// separate them reliably is the shelf price: everything currently at $24.99
// is Pulse, everything at $29.99 is Pulse X.
//
// So the catalog groups by UPC prefix (the brand) and then by current price
// (the product), which is the pair the owner actually reasons about:
// "everything that costs $24.99 now becomes $25.99".

// Rows sharing a current price. A row whose stores disagree has no single
// current price, so it lands in its own bucket (cents === null) to be looked
// at rather than swept along with a blanket change.
export function priceBuckets(rows, { prefixLen = 0 } = {}) {
  const buckets = new Map();
  for (const row of rows) {
    const cents = normPrice(row.prices);
    const key = cents == null ? 'mixed' : String(cents);
    if (!buckets.has(key)) buckets.set(key, { key, cents, rows: [] });
    buckets.get(key).rows.push(row);
  }

  const all = [...buckets.values()];
  return all
    .map(b => {
      // A bucket's span ends wherever an item priced differently interrupts
      // it — which is precisely how Pulse X splits Pulse in two.
      const others = all
        .filter(o => o.key !== b.key)
        .flatMap(o => o.rows.map(r => r.upc));
      return {
        ...b,
        count: b.rows.length,
        ranges: upcRanges(b.rows.map(r => r.upc), prefixLen, { breakAt: others }),
      };
    })
    // Biggest first: the main product line is what the owner came to reprice.
    .sort((a, b) => b.count - a.count || (a.cents ?? Infinity) - (b.cents ?? Infinity));
}

// Trailing digits of a UPC, as a number — null unless every suffix in the set
// is numeric and the same width, because otherwise it is not a number line.
function suffixNumbers(upcs, prefixLen) {
  const suffixes = upcs.map(u => String(u).slice(prefixLen));
  if (!suffixes.length || !suffixes.every(sfx => /^[0-9]+$/.test(sfx))) return null;
  const width = suffixes[0].length;
  if (!suffixes.every(sfx => sfx.length === width)) return null;
  return { nums: [...new Set(suffixes.map(Number))].sort((a, b) => a - b), width };
}

/**
 * Readable spans of the trailing digits, e.g. ["0100-0200", "0301-0500"].
 *
 * Display only — nothing is priced by range. With no `breakAt` the honest
 * answer is a single span from lowest to highest, because a gap on its own
 * says nothing: product numbering is sparse. Passing the UPCs that belong to
 * other products splits the span exactly where they interleave, which needs
 * no guessing about how big a gap is meaningful.
 */
export function upcRanges(upcs, prefixLen = 0, { breakAt = [], max = 6 } = {}) {
  const own = suffixNumbers(upcs, prefixLen);
  if (!own) return [];
  const foreign = breakAt.length ? (suffixNumbers(breakAt, prefixLen)?.nums ?? []) : [];
  const pad = (n) => String(n).padStart(own.width, '0');

  const spans = [];
  let start = own.nums[0], prev = own.nums[0];
  for (const n of own.nums.slice(1)) {
    if (foreign.some(f => f > prev && f < n)) { spans.push([start, prev]); start = n; }
    prev = n;
  }
  spans.push([start, prev]);

  const shown = spans.slice(0, max).map(([a, b]) => (a === b ? pad(a) : `${pad(a)}-${pad(b)}`));
  if (spans.length > max) shown.push(`+${spans.length - max} more`);
  return shown;
}
