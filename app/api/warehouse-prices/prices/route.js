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

    // In-process smart filter. Every whitespace token must appear somewhere
    // in the concatenated blob — lets "foger berry 40" match an item named
    // "FOGER SWITCH PRO 5% DISPOSABLE POD 5PK (Berry Bliss)" at $40.
    let filtered = rows || [];
    if (q) {
      const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
      filtered = filtered.filter(r => {
        const blob = [
          r.products?.name,
          r.products?.variant,
          r.products?.upc,
          r.vendor_name,
          r.invoice_number,
          String(r.unit_price || ''),
        ].filter(Boolean).join(' ').toLowerCase();
        return tokens.every(t => blob.includes(t));
      }).slice(0, limit);
    }

    // Earlier ingests ran before PDF storage was wired, so their invoices
    // rows have an empty image_url. If the same invoice_number was later
    // re-ingested (and got a duplicate row with a URL), pick up that URL
    // so every price row for that invoice can link back to the PDF.
    const numbersMissingUrl = new Set();
    for (const r of filtered) {
      if (r.invoice_number && !(r.invoices?.image_url)) {
        numbersMissingUrl.add(r.invoice_number);
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

    const prices = filtered.map(r => {
      const directUrl = r.invoices?.image_url || null;
      const fallbackUrl = r.invoice_number ? (urlByNumber.get(r.invoice_number) || null) : null;
      return {
        id: r.id,
        product: r.products ? {
          id: r.products.id,
          name: r.products.name,
          variant: r.products.variant,
          upc: r.products.upc,
        } : null,
        vendor: { id: r.vendor_id, name: r.vendor_name },
        invoice: {
          id: r.invoice_id,
          number: r.invoice_number,
          date: r.invoice_date,
          url: directUrl || fallbackUrl,
          source: r.invoices?.parse_source || null,
        },
        unit_price: r.unit_price,
        sold_unit_price: r.sold_unit_price,
        line_discount: r.line_discount,
        quantity: r.quantity,
      };
    });

    return NextResponse.json({ prices });
  } catch (e) {
    console.error('[warehouse-prices/prices]', e);
    return NextResponse.json({ error: e.message || 'List failed' }, { status: 500 });
  }
}
