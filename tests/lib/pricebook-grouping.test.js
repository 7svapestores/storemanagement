import { describe, it, expect } from 'vitest';
import {
  normalizeName, consensusName, buildRows, familyKey, detectVariantDigits,
  commonNamePrefix, commonUpcPrefix, variantLabel, buildFamilies, normPrice, customStores,
  planWrites, countProtected, SKIP_REASON,
} from '@/lib/pricebook-grouping';

const S = { reno: 'reno', troup: 'troup', bells: 'bells', denison: 'denison', kerens: 'kerens' };
const ALL = Object.values(S);

// Same product, five stores, names typed slightly differently per store.
const item = (upc, name, cents) => ({ upc, name, cents });
const store = (id, items) => ({ store: { id, name: id }, items });

describe('normalizeName / consensusName', () => {
  it('flattens case, punctuation and spacing', () => {
    expect(normalizeName('Geek-Bar  Pulse')).toBe('GEEK BAR PULSE');
    expect(normalizeName(null)).toBe('');
  });

  it('picks the spelling most stores use', () => {
    expect(consensusName(['GEEKBAR PULSE', 'GEEKBAR PULSE', 'GB PULSE'])).toBe('GEEKBAR PULSE');
  });

  it('breaks a tie toward the more detailed name', () => {
    expect(consensusName(['GEEKBAR PULSE 15K', 'GEEKBAR'])).toBe('GEEKBAR PULSE 15K');
  });
});

describe('buildRows', () => {
  const perStore = [
    store(S.reno, [item('810082001', 'Geekbar Pulse Watermelon', 2299)]),
    store(S.troup, [item('810082001', 'GEEKBAR PULSE WATERMELON', 2299)]),
    store(S.denison, [item('810082001', 'Geekbar Pulse Watermelon', 2399)]),
  ];

  it('collapses one UPC across stores into a single row', () => {
    const rows = buildRows(perStore);
    expect(rows).toHaveLength(1);
    expect(rows[0].prices).toEqual({ reno: 2299, troup: 2299, denison: 2399 });
  });

  it('leaves stores that do not carry the item absent, not zero', () => {
    const rows = buildRows(perStore);
    expect(rows[0].prices[S.bells]).toBeUndefined();
  });

  it('does not treat case and punctuation as a name conflict', () => {
    expect(buildRows(perStore)[0].nameConflict).toBe(false);
  });

  it('flags a genuine spelling mismatch between stores', () => {
    const rows = buildRows([
      store(S.reno, [item('810082001', 'Geekbar Pulse Watermelon', 2299)]),
      store(S.troup, [item('810082001', 'GB Pulse Wtrmln', 2299)]),
    ]);
    expect(rows[0].nameConflict).toBe(true);
  });

  it('ignores items with no UPC', () => {
    expect(buildRows([store(S.reno, [item('', 'Mystery', 100)])])).toHaveLength(0);
  });
});

describe('family grouping', () => {
  it('masks the trailing variant digits', () => {
    expect(familyKey('810082001', 3)).toBe('9:810082');
    expect(familyKey('810082002', 3)).toBe('9:810082');
  });

  // UPCs of different lengths are different vendors' schemes; never merge them.
  it('keeps equal prefixes of different lengths apart', () => {
    expect(familyKey('810082001', 3)).not.toBe(familyKey('8100820013', 3));
  });

  it('finds the leading words a family shares', () => {
    expect(commonNamePrefix(['GEEKBAR PULSE WATERMELON', 'GEEKBAR PULSE BLUE RAZZ']))
      .toBe('GEEKBAR PULSE');
  });

  it('returns nothing when names share no start', () => {
    expect(commonNamePrefix(['GEEKBAR PULSE', 'RAZ TN9000'])).toBe('');
  });

  it('strips the family name to leave the flavor', () => {
    expect(variantLabel('Geekbar Pulse Watermelon Ice', 'GEEKBAR PULSE')).toBe('WATERMELON ICE');
  });

  it('falls back to the whole name when it does not start with the family', () => {
    expect(variantLabel('GB Pulse Mint', 'GEEKBAR PULSE')).toBe('GB PULSE MINT');
  });

  // Whether a brand's flavor code is 2 or 3 digits usually cannot be told
  // from the data, so assert the outcome that matters — the brand stays in
  // one family — rather than a specific mask width.
  it('keeps a full flavor range in one family', () => {
    const flavors = ['Watermelon', 'Blue Razz', 'Mint', 'Grape', 'Cherry', 'Mango',
                     'Peach', 'Lemon', 'Berry', 'Apple', 'Melon', 'Citrus'];
    const rows = buildRows([store(S.reno, flavors.map((f, i) =>
      item(`810082${String(i + 1).padStart(3, '0')}`, `Geekbar Pulse ${f}`, 2299)))]);

    const { families } = buildFamilies(rows);
    expect(families).toHaveLength(1);
    expect(families[0].label).toBe('GEEKBAR PULSE');
    expect(families[0].items).toHaveLength(12);
  });

  it('reports the digits the family actually shares', () => {
    const rows = buildRows([store(S.reno, [
      item('810082001', 'Geekbar Pulse Watermelon', 2299),
      item('810082150', 'Geekbar Pulse Mango', 2299),
    ])]);
    expect(buildFamilies(rows, { variantDigits: 3 }).families[0].upcPrefix).toBe('810082');
  });

  it('honours a mask the owner sets by hand', () => {
    const rows = buildRows([store(S.reno, [
      item('810082001', 'Geekbar Pulse Watermelon', 2299),
      item('810082101', 'Geekbar Pulse Mango', 2299),
    ])]);
    // Narrow: the two differ in the third-from-last digit, so they split.
    expect(buildFamilies(rows, { variantDigits: 2 }).families).toHaveLength(2);
    // Wide: one family.
    expect(buildFamilies(rows, { variantDigits: 3 }).families).toHaveLength(1);
  });

  // The failure that matters: masking so much that two brands merge.
  it('does not mask so far that unrelated brands merge', () => {
    const rows = buildRows([store(S.reno, [
      item('810082001', 'Geekbar Pulse Watermelon', 2299),
      item('810082002', 'Geekbar Pulse Blue Razz', 2299),
      item('810099001', 'Raz TN9000 Mint', 1999),
      item('810099002', 'Raz TN9000 Grape', 1999),
    ])]);
    const { families } = buildFamilies(rows, { variantDigits: detectVariantDigits(rows) });
    expect(families).toHaveLength(2);
    expect(families.map(f => f.label).sort()).toEqual(['GEEKBAR PULSE', 'RAZ TN9000']);
  });

  it('labels a family and lists its flavors', () => {
    const rows = buildRows([store(S.reno, [
      item('810082001', 'Geekbar Pulse Watermelon', 2299),
      item('810082002', 'Geekbar Pulse Blue Razz', 2299),
    ])]);
    const { families } = buildFamilies(rows, { variantDigits: 3 });
    expect(families[0].label).toBe('GEEKBAR PULSE');
    // Only 001 and 002 are present, so the digits they genuinely share run to
    // 81008200 — the prefix reported is the data's, not the mask's.
    expect(families[0].upcPrefix).toBe('81008200');
    expect(families[0].items.map(i => i.variant)).toEqual(['BLUE RAZZ', 'WATERMELON']);
  });

  it('keeps a one-off item as its own family rather than dropping it', () => {
    const rows = buildRows([store(S.reno, [item('999999999', 'Lighter', 199)])]);
    const { families } = buildFamilies(rows, { variantDigits: 3 });
    expect(families).toHaveLength(1);
    expect(families[0].items).toHaveLength(1);
  });
});

describe('normPrice / customStores', () => {
  it('takes the price most stores charge as the norm', () => {
    expect(normPrice({ a: 2299, b: 2299, c: 2299, d: 2399 })).toBe(2299);
  });

  it('has no norm when stores split evenly', () => {
    expect(normPrice({ a: 2299, b: 2399 })).toBeNull();
  });

  it('has no norm when every store already agrees on nothing', () => {
    expect(normPrice({ a: 1, b: 2, c: 3 })).toBeNull();
  });

  it('identifies the store holding a deliberate different price', () => {
    const row = { prices: { a: 2299, b: 2299, c: 2299, d: 2399 } };
    expect(customStores(row)).toEqual(['d']);
  });

  it('calls nothing custom when there is no majority to differ from', () => {
    expect(customStores({ prices: { a: 2299, b: 2399 } })).toEqual([]);
  });
});

describe('planWrites', () => {
  // Denison deliberately sits $1 above the others.
  const rows = buildRows([
    store(S.reno, [item('810082001', 'Geekbar Pulse Watermelon', 2299)]),
    store(S.troup, [item('810082001', 'Geekbar Pulse Watermelon', 2299)]),
    store(S.bells, [item('810082001', 'Geekbar Pulse Watermelon', 2299)]),
    store(S.kerens, [item('810082001', 'Geekbar Pulse Watermelon', 2299)]),
    store(S.denison, [item('810082001', 'Geekbar Pulse Watermelon', 2399)]),
  ]);
  const to2499 = { storeIds: ALL, priceFor: () => 2499 };

  it('protects the deliberately different store by default', () => {
    const { writes, skipped } = planWrites(rows, to2499);
    expect(writes.map(w => w.store_id).sort()).toEqual(['bells', 'kerens', 'reno', 'troup']);
    expect(skipped).toEqual([
      { store_id: 'denison', upc: '810082001', name: 'Geekbar Pulse Watermelon', reason: SKIP_REASON.CUSTOM_PRICE, from: 2399, to: 2499 },
    ]);
  });

  it('includes it once the owner opts in', () => {
    const { writes } = planWrites(rows, { ...to2499, includeCustom: true });
    expect(writes).toHaveLength(5);
    expect(writes.find(w => w.store_id === 'denison')).toMatchObject({ from: 2399, to: 2499 });
  });

  it('writes only the stores that were ticked', () => {
    const { writes } = planWrites(rows, { ...to2499, storeIds: [S.reno, S.troup] });
    expect(writes.map(w => w.store_id)).toEqual(['reno', 'troup']);
  });

  it('never writes a store that does not carry the item', () => {
    const partial = buildRows([store(S.reno, [item('810082001', 'Geekbar Pulse', 2299)])]);
    const { writes, skipped } = planWrites(partial, to2499);
    expect(writes).toHaveLength(1);
    expect(skipped.every(s => s.reason === SKIP_REASON.NOT_CARRIED)).toBe(true);
  });

  it('skips stores already at the target price instead of re-posting them', () => {
    const { writes, skipped } = planWrites(rows, { storeIds: ALL, priceFor: () => 2299 });
    expect(writes).toHaveLength(0);
    expect(skipped.filter(s => s.reason === SKIP_REASON.ALREADY_SET)).toHaveLength(4);
  });

  it('carries old and new price on every write for the review screen', () => {
    const { writes } = planWrites(rows, to2499);
    expect(writes[0]).toMatchObject({ upc: '810082001', from: 2299, to: 2499 });
  });

  it('ignores rows the caller prices as null', () => {
    expect(planWrites(rows, { storeIds: ALL, priceFor: () => null }).writes).toHaveLength(0);
  });

  it('rejects a negative price rather than writing it', () => {
    expect(planWrites(rows, { storeIds: ALL, priceFor: () => -1 }).writes).toHaveLength(0);
  });

  it('counts the protected stores for the prompt', () => {
    expect(countProtected(rows, ALL)).toBe(1);
    expect(countProtected(rows, [S.reno, S.troup])).toBe(0);
  });
});
