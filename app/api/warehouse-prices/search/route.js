import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Smart search over the product catalog.
// Given a query, find matching products, then for each product
// return every warehouse's latest price (via product_best_prices view),
// sorted cheapest first.
//
// GET /api/warehouse-prices/search?q=foger+berry&limit=10
export async function GET(req) {
  try {
    const userSupa = createClient();
    const { data: { user } } = await userSupa.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const limit = Math.min(parseInt(searchParams.get('limit') || '15', 10), 50);
    if (!q) return NextResponse.json({ products: [] });

    const admin = createAdminClient();

    // If the query is a UPC/barcode, resolve directly.
    let products = [];
    if (/^\d{10,14}$/.test(q)) {
      const { data } = await admin
        .from('products')
        .select('id, upc, name, brand, variant, category')
        .eq('upc', q)
        .limit(1);
      products = data || [];
    }

    // Token-based ILIKE search on the stored search_blob. Each token must match.
    // Not as nice as full-text, but zero-setup and good enough for typos like "foger berry".
    if (!products.length) {
      const tokens = q.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
      let query = admin
        .from('products')
        .select('id, upc, name, brand, variant, category, search_blob')
        .limit(limit * 3); // overselect; we re-rank below
      for (const t of tokens) query = query.ilike('search_blob', `%${t}%`);
      const { data } = await query;
      products = data || [];
    }

    if (!products.length) return NextResponse.json({ products: [] });

    // Fetch every vendor's latest price for the matched products.
    const ids = products.map(p => p.id);
    const { data: prices } = await admin
      .from('product_best_prices')
      .select('product_id, vendor_id, vendor_name, unit_price, last_bought, invoice_number, quantity')
      .in('product_id', ids);

    const byProduct = new Map();
    for (const row of (prices || [])) {
      if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, []);
      byProduct.get(row.product_id).push(row);
    }

    // Re-rank products: those with prices first, then by how well the name matches.
    const qLower = q.toLowerCase();
    const scored = products.map(p => {
      const offers = (byProduct.get(p.id) || []).sort((a, b) => a.unit_price - b.unit_price);
      const cheapest = offers[0] || null;
      // Tiny heuristic: exact-token name hit boosts the score.
      let score = offers.length ? 10 : 0;
      for (const tok of qLower.split(/\s+/)) {
        if (tok && (p.name || '').toLowerCase().includes(tok)) score += 1;
      }
      return { ...p, search_blob: undefined, offers, cheapest, _score: score };
    });
    scored.sort((a, b) => b._score - a._score);

    return NextResponse.json({ products: scored.slice(0, limit).map(({ _score, ...rest }) => rest) });
  } catch (e) {
    console.error('[warehouse-prices/search]', e);
    return NextResponse.json({ error: e.message || 'Search failed' }, { status: 500 });
  }
}
