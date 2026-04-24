import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Returns every recorded product-price row (one per invoice line item),
// joined with product, vendor, and invoice data so the UI can render a
// full table with invoice deep-links.
//
// GET /api/warehouse-prices/prices?q=foger&limit=50&offset=0
// Smart search: when q is supplied, rows are kept where any of the searched
// fields contains every whitespace-separated token (case-insensitive).
export async function GET(req) {
  try {
    const userSupa = createClient();
    const { data: { user } } = await userSupa.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);

    const admin = createAdminClient();

    // Overfetch when filtering so token-AND matching across joined tables
    // still returns a reasonable page. If this ever gets slow we can move
    // the filter into a Postgres search_blob view.
    const fetchLimit = q ? Math.min(limit * 6, 1500) : limit;
    const { data: rows, error } = await admin
      .from('product_prices')
      .select(`
        id,
        unit_price,
        sold_unit_price,
        line_discount,
        quantity,
        invoice_date,
        invoice_number,
        vendor_id,
        vendor_name,
        invoice_id,
        products ( id, name, variant, upc ),
        invoices ( image_url, parse_source )
      `)
      .order('invoice_date', { ascending: false })
      .range(offset, offset + fetchLimit - 1);
    if (error) throw error;

    // Aggregate to one row per (product, vendor). For each group, keep the
    // row with the LOWEST unit_price — that's the "best deal we've ever seen
    // from this warehouse" — and sum quantities across all historical
    // purchases so the qty column reflects total units ever bought.
    //
    // Rationale: the same SKU can legitimately appear multiple times on a
    // single invoice (real line-item repeats), and across multiple invoices
    // over time. Showing every raw row buries the signal the owner cares
    // about: which warehouse has this cheapest.
    const groups = new Map();
    for (const r of (rows || [])) {
      if (!r.products?.id) continue;
      const key = `${r.products.id}:${r.vendor_id || 'null'}`;
      const existing = groups.get(key);
      const qty = Number(r.quantity) || 0;
      if (!existing) {
        groups.set(key, { best: r, qtySum: qty, latestDate: r.invoice_date, purchaseCount: 1 });
      } else {
        existing.qtySum += qty;
        existing.purchaseCount += 1;
        if (r.invoice_date && (!existing.latestDate || r.invoice_date > existing.latestDate)) {
          existing.latestDate = r.invoice_date;
        }
        // Lower price wins — we never "update" to a higher price.
        if (Number(r.unit_price) < Number(existing.best.unit_price)) {
          existing.best = r;
        }
      }
    }

    // Smart search filter runs AFTER aggregation so token matching works on
    // the displayed row (including the best price).
    let aggregated = Array.from(groups.values());
    if (q) {
      const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
      aggregated = aggregated.filter(g => {
        const blob = [
          g.best.products?.name,
          g.best.products?.variant,
          g.best.products?.upc,
          g.best.vendor_name,
          g.best.invoice_number,
          String(g.best.unit_price || ''),
        ].filter(Boolean).join(' ').toLowerCase();
        return tokens.every(t => blob.includes(t));
      });
    }
    // Newest-first feels most useful as a default sort.
    aggregated.sort((a, b) => String(b.latestDate || '').localeCompare(String(a.latestDate || '')));
    aggregated = aggregated.slice(0, limit);

    // Fallback URL lookup: earlier ingests left image_url empty. If a sibling
    // row exists for the same invoice_number with a URL, use that.
    const numbersMissingUrl = new Set();
    for (const g of aggregated) {
      if (g.best.invoice_number && !(g.best.invoices?.image_url)) {
        numbersMissingUrl.add(g.best.invoice_number);
      }
    }
    const urlByNumber = new Map();
    if (numbersMissingUrl.size) {
      const { data: siblings } = await admin
        .from('invoices')
        .select('invoice_number, image_url')
        .in('invoice_number', Array.from(numbersMissingUrl))
        .not('image_url', 'is', null)
        .neq('image_url', '');
      for (const s of (siblings || [])) {
        if (s.image_url && !urlByNumber.has(s.invoice_number)) {
          urlByNumber.set(s.invoice_number, s.image_url);
        }
      }
    }

    const prices = aggregated.map(g => {
      const r = g.best;
      const directUrl = r.invoices?.image_url || null;
      const fallbackUrl = r.invoice_number ? (urlByNumber.get(r.invoice_number) || null) : null;
      return {
        id: r.id,
        product: {
          id: r.products.id,
          name: r.products.name,
          variant: r.products.variant,
          upc: r.products.upc,
        },
        vendor: { id: r.vendor_id, name: r.vendor_name },
        invoice: {
          id: r.invoice_id,
          number: r.invoice_number,
          date: r.invoice_date,
          url: directUrl || fallbackUrl,
          source: r.invoices?.parse_source || null,
        },
        unit_price: r.unit_price,         // lowest ever at this vendor
        sold_unit_price: r.sold_unit_price,
        line_discount: r.line_discount,
        quantity: g.qtySum,               // total units bought across all invoices
        purchase_count: g.purchaseCount,  // how many invoice lines rolled up
        last_bought: g.latestDate,
      };
    });

    return NextResponse.json({ prices });
  } catch (e) {
    console.error('[warehouse-prices/prices]', e);
    return NextResponse.json({ error: e.message || 'List failed' }, { status: 500 });
  }
}
