import { NextResponse } from 'next/server';
import { listPricebookItems } from '@/lib/nrs-pricebook';
import { buildRows, buildFamilies } from '@/lib/pricebook-grouping';
import { requireOwner, loadNrsStores, mapWithConcurrency, STORE_CONCURRENCY } from '@/lib/pricebook-stores';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/pricebook/matrix?q=geekbar&variant_digits=3
//
// Searches every NRS store at once and returns the same product grouped
// across stores: one row per UPC carrying a price per store, and rows
// collapsed into families (a brand and its flavors). Owner-only.
//
// A store that fails is reported rather than failing the request — four
// stores' prices are still worth showing, as long as the UI says the fifth
// is missing rather than implying it doesn't carry the item.
export async function GET(req) {
  try {
    const gate = await requireOwner();
    if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const length = Math.min(Math.max(parseInt(searchParams.get('length') || '100', 10), 1), 200);
    const rawDigits = parseInt(searchParams.get('variant_digits') || '', 10);
    const variantDigits = Number.isInteger(rawDigits) && rawDigits >= 1 && rawDigits <= 5 ? rawDigits : undefined;

    if (q.length < 2) {
      return NextResponse.json({ error: 'Enter at least 2 characters to search' }, { status: 400 });
    }

    const stores = await loadNrsStores(gate.admin);
    if (!stores.length) {
      return NextResponse.json({ error: 'No stores have an NRS ID configured' }, { status: 400 });
    }

    const settled = await mapWithConcurrency(stores, STORE_CONCURRENCY, async (store) => {
      const { items } = await listPricebookItems(store.nrs_store_id, { search: q, start: 0, length });
      return { store: { id: store.id, name: store.name }, items };
    });

    const perStore = [];
    const failures = [];
    settled.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') perStore.push(outcome.value);
      else failures.push({ store: stores[i].name, error: outcome.reason?.message || String(outcome.reason) });
    });

    if (!perStore.length) {
      return NextResponse.json({ error: `Every store failed: ${failures[0]?.error || 'unknown error'}` }, { status: 502 });
    }

    const rows = buildRows(perStore);
    const grouped = buildFamilies(rows, { variantDigits });

    return NextResponse.json({
      query: q,
      stores: stores.map(s => ({ id: s.id, name: s.name })),
      // Stores whose search failed: their prices are unknown, not absent.
      unavailable: failures,
      variantDigits: grouped.variantDigits,
      families: grouped.families,
      totalItems: rows.length,
    });
  } catch (e) {
    console.error('[pricebook/matrix]', e);
    return NextResponse.json({ error: e.message || 'Search failed' }, { status: 500 });
  }
}
