import { NextResponse } from 'next/server';
import { listPricebookItems } from '@/lib/nrs-pricebook';
import { requireOwner, loadNrsStores } from '@/lib/pricebook-stores';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// One page of items per request. NRS is paged and this project runs on a
// plan with a short function timeout, so the client drives the loop and each
// call does a small, bounded amount of work rather than one long request
// that would be cut off partway through.
const PAGE = 200;

// POST /api/pricebook/catalog/sync
// Body: { store_id, start, run_id }
//
// Pulls one page of a store's pricebook into the pricebook_items cache and
// reports where to continue. Sending `start: 0` begins a pass; when the last
// page lands, rows left over from earlier passes (items the store has since
// deleted) are cleared. Owner-only.
export async function POST(req) {
  try {
    const gate = await requireOwner();
    if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const { store_id, start = 0, run_id } = await req.json();
    if (!store_id) return NextResponse.json({ error: 'store_id required' }, { status: 400 });
    if (!run_id) return NextResponse.json({ error: 'run_id required' }, { status: 400 });

    const offset = Number(start);
    if (!Number.isInteger(offset) || offset < 0) {
      return NextResponse.json({ error: 'start must be a non-negative integer' }, { status: 400 });
    }

    const [store] = await loadNrsStores(gate.admin, [store_id]);
    if (!store) return NextResponse.json({ error: 'Store has no NRS ID configured' }, { status: 400 });

    // An empty search term asks NRS for the store's whole pricebook.
    const { items, recordsFiltered } = await listPricebookItems(store.nrs_store_id, {
      search: '', start: offset, length: PAGE,
    });

    const rows = items
      .map(it => ({
        store_id: store.id,
        upc: String(it.upc || it.upcorplu || '').trim(),
        name: it.name || it.desc || '',
        dept: it.dept || null,
        size: it.size || null,
        cents: Number.isFinite(it.cents) ? it.cents : null,
        cost_cents: Number.isFinite(it.cost_cents) ? it.cost_cents : null,
        run_id,
        synced_at: new Date().toISOString(),
      }))
      .filter(r => r.upc);

    if (rows.length) {
      const { error } = await gate.admin
        .from('pricebook_items')
        .upsert(rows, { onConflict: 'store_id,upc' });
      if (error) throw new Error(`Could not cache items: ${error.message}`);
    }

    const nextStart = offset + items.length;
    // NRS reports the total, but trust the short page too: if it returned
    // fewer rows than asked for, there is nothing after it.
    const done = items.length < PAGE || nextStart >= (recordsFiltered || 0);

    if (done) {
      // Anything not touched by this pass no longer exists in the store.
      const { error } = await gate.admin
        .from('pricebook_items')
        .delete()
        .eq('store_id', store.id)
        .neq('run_id', run_id);
      if (error) console.warn('[catalog/sync] stale cleanup failed:', error.message);
    }

    return NextResponse.json({
      store: { id: store.id, name: store.name },
      fetched: items.length,
      cached: rows.length,
      start: offset,
      next_start: done ? null : nextStart,
      total: recordsFiltered ?? null,
      done,
    });
  } catch (e) {
    console.error('[pricebook/catalog/sync]', e);
    return NextResponse.json({ error: e.message || 'Sync failed' }, { status: 500 });
  }
}
