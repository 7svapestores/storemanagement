import { NextResponse } from 'next/server';
import { buildRows } from '@/lib/pricebook-grouping';
import { requireOwner, loadNrsStores } from '@/lib/pricebook-stores';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_ROWS = 2000;

// GET /api/pricebook/catalog/items?prefix=810082
//
// Every cached item whose UPC starts with `prefix`, collapsed into one row
// per UPC carrying a price per store — the same shape the multi-store price
// editor works on. Owner-only.
export async function GET(req) {
  try {
    const gate = await requireOwner();
    if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const { searchParams } = new URL(req.url);
    const prefix = (searchParams.get('prefix') || '').trim();
    // Digits only: the value is interpolated into a LIKE pattern, and a UPC
    // has no business containing % or _.
    if (!/^[0-9]{3,14}$/.test(prefix)) {
      return NextResponse.json({ error: 'prefix must be 3-14 digits' }, { status: 400 });
    }

    const stores = await loadNrsStores(gate.admin);
    const byStoreId = new Map(stores.map(s => [s.id, s]));

    const { data, error } = await gate.admin
      .from('pricebook_items')
      .select('store_id, upc, name, dept, size, cents, cost_cents')
      .like('upc', `${prefix}%`)
      .order('upc')
      .limit(MAX_ROWS);
    if (error) throw new Error(error.message);

    // Reuse the cross-store collapse the live search uses, so both views
    // present rows identically.
    const perStore = stores.map(s => ({
      store: { id: s.id, name: s.name },
      items: (data || [])
        .filter(r => r.store_id === s.id)
        .map(r => ({ upc: r.upc, name: r.name, cents: r.cents, cost_cents: r.cost_cents })),
    }));

    const rows = buildRows(perStore);
    const orphans = (data || []).filter(r => !byStoreId.has(r.store_id)).length;

    return NextResponse.json({
      prefix,
      stores: stores.map(s => ({ id: s.id, name: s.name })),
      rows,
      truncated: (data || []).length >= MAX_ROWS,
      orphans,
    });
  } catch (e) {
    console.error('[pricebook/catalog/items]', e);
    return NextResponse.json({ error: e.message || 'Could not load items' }, { status: 500 });
  }
}
