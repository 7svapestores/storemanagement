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

    // Fetch every vendor's latest price for the matched products, joined
    // with invoices so the UI can deep-link each offer back to its PDF.
    const ids = products.map(p => p.id);
    const { data: priceRows } = await admin
      .from('product_prices')
      .select('product_id, vendor_id, vendor_name, unit_price, invoice_date, invoice_number, invoice_id, quantity, invoices(image_url)')
      .in('product_id', ids)
      .order('invoice_date', { ascending: false });

    // Aggregate to one offer per (product, vendor), keeping the row with the
    // LOWEST unit_price — so "best price" reflects the cheapest we've ever
    // paid, not the most recent. Newer higher prices never "update" the
    // suggestion.
    const groupMap = new Map(); // key -> best row
    const latestDate = new Map(); // key -> most recent invoice_date (for "last bought" display)
    for (const row of (priceRows || [])) {
      const key = `${row.product_id}:${row.vendor_id || 'null'}`;
      const curLatest = latestDate.get(key);
      if (!curLatest || String(row.invoice_date || '') > curLatest) latestDate.set(key, row.invoice_date);
      const existing = groupMap.get(key);
      if (!existing || Number(row.unit_price) < Number(existing.unit_price)) {
        groupMap.set(key, row);
      }
    }

    const byProduct = new Map();
    for (const [key, row] of groupMap.entries()) {
      if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, []);
      byProduct.get(row.product_id).push({
        vendor_id: row.vendor_id,
        vendor_name: row.vendor_name,
        unit_price: row.unit_price,
        last_bought: latestDate.get(key) || row.invoice_date,
        invoice_number: row.invoice_number,
        invoice_id: row.invoice_id,
        invoice_url: row.invoices?.image_url || null,
        quantity: row.quantity,
      });
    }

    // Same PDF-URL fallback as /prices: if an offer points to an invoice row
    // with no image_url (early uploads), look for a sibling row with the same
    // invoice_number that does have one.
    const missingNumbers = new Set();
    for (const offers of byProduct.values()) {
      for (const o of offers) if (o.invoice_number && !o.invoice_url) missingNumbers.add(o.invoice_number);
    }
    if (missingNumbers.size) {
      const { data: siblings } = await admin
        .from('invoices')
        .select('invoice_number, image_url')
        .in('invoice_number', Array.from(missingNumbers))
        .not('image_url', 'is', null)
        .neq('image_url', '');
      const urlByNumber = new Map();
      for (const s of (siblings || [])) {
        if (s.image_url && !urlByNumber.has(s.invoice_number)) urlByNumber.set(s.invoice_number, s.image_url);
      }
      for (const offers of byProduct.values()) {
        for (const o of offers) {
          if (!o.invoice_url && o.invoice_number) o.invoice_url = urlByNumber.get(o.invoice_number) || null;
        }
      }
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
