import { NextResponse } from 'next/server';
import { requireOwner, loadNrsStores } from '@/lib/pricebook-stores';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/pricebook/catalog?prefix_len=6
//
// The whole cached catalog divided by UPC prefix — no name matching involved.
// Returns one entry per prefix with how many distinct UPCs sit under it, how
// many stores carry them, and the price spread, plus when each store was last
// synced. Owner-only.
export async function GET(req) {
  try {
    const gate = await requireOwner();
    if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const { searchParams } = new URL(req.url);
    const raw = parseInt(searchParams.get('prefix_len') || '6', 10);
    const prefixLen = Number.isInteger(raw) && raw >= 3 && raw <= 12 ? raw : 6;

    const stores = await loadNrsStores(gate.admin);

    const { data: groups, error } = await gate.admin.rpc('pricebook_upc_prefixes', { p_len: prefixLen });
    if (error) {
      // The rollup function ships with add-pricebook-catalog.sql; say so
      // rather than surfacing a bare Postgres error.
      if (/function .*pricebook_upc_prefixes/i.test(error.message)) {
        return NextResponse.json({ error: 'Catalog tables are not installed yet — run the add-pricebook-catalog.sql migration.' }, { status: 503 });
      }
      throw new Error(error.message);
    }

    // Per-store freshness, so a half-finished sync is visible rather than
    // quietly showing a stale catalog as if it were current.
    const syncStatus = [];
    for (const store of stores) {
      const { count } = await gate.admin
        .from('pricebook_items')
        .select('upc', { count: 'exact', head: true })
        .eq('store_id', store.id);
      const { data: latest } = await gate.admin
        .from('pricebook_items')
        .select('synced_at')
        .eq('store_id', store.id)
        .order('synced_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      syncStatus.push({
        store_id: store.id,
        name: store.name,
        items: count ?? 0,
        last_synced: latest?.synced_at ?? null,
      });
    }

    return NextResponse.json({
      prefixLen,
      stores: stores.map(s => ({ id: s.id, name: s.name })),
      syncStatus,
      groups: groups || [],
      totalGroups: (groups || []).length,
    });
  } catch (e) {
    console.error('[pricebook/catalog]', e);
    return NextResponse.json({ error: e.message || 'Could not load catalog' }, { status: 500 });
  }
}
