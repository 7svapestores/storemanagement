import { NextResponse } from 'next/server';
import { updatePricebookItemPrice } from '@/lib/nrs-pricebook';
import { requireOwner, loadNrsStores, mapWithConcurrency, STORE_CONCURRENCY } from '@/lib/pricebook-stores';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// A price change touches real shelf prices, so the batch is bounded. 300 is
// comfortably more than a brand's flavor list across five stores.
const MAX_WRITES = 300;

// POST /api/pricebook/bulk-update
// Body: { writes: [{ store_id, upc, cents }] }
//
// Applies price changes across several stores in one go. Each write is
// independent: one failure doesn't block the rest, and every write comes back
// with its own result so the UI can show exactly what landed. Owner-only.
//
// The caller decides which stores to write — protecting a store's deliberate
// custom price is a decision made in the UI (lib/pricebook-grouping.js), so
// by the time a write reaches here it has already been confirmed.
export async function POST(req) {
  try {
    const gate = await requireOwner();
    if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const { writes } = await req.json();
    if (!Array.isArray(writes) || writes.length === 0) {
      return NextResponse.json({ error: 'writes array required' }, { status: 400 });
    }
    if (writes.length > MAX_WRITES) {
      return NextResponse.json({ error: `Too many changes in one request (max ${MAX_WRITES})` }, { status: 400 });
    }

    // Validate everything before touching NRS — a partly-applied batch caused
    // by a typo in the last row is the worst outcome here.
    const clean = [];
    const seen = new Set();
    for (const w of writes) {
      const storeId = String(w?.store_id || '').trim();
      const upc = String(w?.upc || '').trim();
      const cents = Number(w?.cents);
      if (!storeId || !upc) {
        return NextResponse.json({ error: 'Each change needs a store_id and upc' }, { status: 400 });
      }
      if (!Number.isInteger(cents) || cents < 0) {
        return NextResponse.json({ error: `Invalid price for ${upc}` }, { status: 400 });
      }
      const key = `${storeId}|${upc}`;
      if (seen.has(key)) {
        return NextResponse.json({ error: `Duplicate change for ${upc} in the same store` }, { status: 400 });
      }
      seen.add(key);
      clean.push({ storeId, upc, cents });
    }

    const stores = await loadNrsStores(gate.admin, [...new Set(clean.map(c => c.storeId))]);
    const byId = new Map(stores.map(s => [s.id, s]));
    const unknown = clean.find(c => !byId.has(c.storeId));
    if (unknown) {
      return NextResponse.json({ error: 'A selected store has no NRS ID configured' }, { status: 400 });
    }

    const userLabel = gate.profile.name ? `${gate.profile.name} (StoreWise)` : '7S StoreWise';

    // Group by store so each store's writes run in order, and only a couple of
    // stores are in flight at once — same reasoning as the sync cron.
    const byStore = [...byId.values()].map(store => ({
      store,
      items: clean.filter(c => c.storeId === store.id),
    }));

    const results = [];
    await mapWithConcurrency(byStore, STORE_CONCURRENCY, async ({ store, items }) => {
      for (const { upc, cents } of items) {
        try {
          const r = await updatePricebookItemPrice(store.nrs_store_id, upc, cents, { user: userLabel });
          results.push({ store_id: store.id, store_name: store.name, upc, ok: true, ...r });
        } catch (e) {
          console.error(`[pricebook/bulk-update] ${store.name} ${upc} failed:`, e.message);
          results.push({ store_id: store.id, store_name: store.name, upc, ok: false, error: e.message || 'Update failed' });
        }
      }
    });

    const updated = results.filter(r => r.ok && !r.unchanged).length;
    const unchanged = results.filter(r => r.ok && r.unchanged).length;
    const failed = results.filter(r => !r.ok).length;
    return NextResponse.json({ updated, unchanged, failed, results });
  } catch (e) {
    console.error('[pricebook/bulk-update]', e);
    return NextResponse.json({ error: e.message || 'Update failed' }, { status: 500 });
  }
}
