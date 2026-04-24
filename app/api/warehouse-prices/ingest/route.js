import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase-server';
import { parsePdfBuffer, extractPdfText } from '@/lib/invoice-parser';

export const dynamic = 'force-dynamic';
// pdf-parse pulls heavy deps; keep it on Node, not Edge.
export const runtime = 'nodejs';
// PDFs can be a few MB; bump body limit.
export const maxDuration = 60;

// Upsert a vendor by name, returning its id. Case-insensitive match.
async function ensureVendor(admin, vendorName) {
  const name = vendorName.trim();
  const { data: existing } = await admin
    .from('vendors')
    .select('id, name')
    .ilike('name', name)
    .limit(1);
  if (existing && existing[0]) return existing[0].id;
  const { data: inserted, error } = await admin
    .from('vendors')
    .insert({ name, category: 'Warehouse' })
    .select('id')
    .single();
  if (error) throw error;
  return inserted.id;
}

// Upsert a product by UPC. If no UPC match, create fresh.
async function ensureProduct(admin, item) {
  if (item.upc) {
    const { data: existing } = await admin
      .from('products')
      .select('id, name, brand, variant')
      .eq('upc', item.upc)
      .limit(1);
    if (existing && existing[0]) return existing[0].id;
  }
  const { data: inserted, error } = await admin
    .from('products')
    .insert({
      upc: item.upc || null,
      name: item.name || item.description,
      variant: item.variant || null,
    })
    .select('id')
    .single();
  if (error) {
    // UPC race/dup — refetch.
    if (error.code === '23505' && item.upc) {
      const { data: again } = await admin.from('products').select('id').eq('upc', item.upc).single();
      return again?.id;
    }
    throw error;
  }
  return inserted.id;
}

export async function POST(req) {
  try {
    // Auth: owner only.
    const userSupa = createClient();
    const { data: { user } } = await userSupa.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminClient();
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 });

    // Read PDF from multipart form.
    const form = await req.formData();
    const file = form.get('file');
    const storeId = form.get('store_id') || null;
    const debug = form.get('debug') === '1' || new URL(req.url).searchParams.get('debug') === '1';
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No PDF attached' }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());

    // Debug mode: return raw text only, no parsing or DB write.
    if (debug) {
      const text = await extractPdfText(buffer);
      return NextResponse.json({ debug: true, filename: file.name, text });
    }

    // Parse.
    let parsed;
    try {
      parsed = await parsePdfBuffer(buffer);
    } catch (e) {
      const code = e.code === 'UNKNOWN_FORMAT' ? 422 : 500;
      return NextResponse.json({ error: e.message, code: e.code }, { status: code });
    }

    const { header, items, raw_text } = parsed;
    if (!items?.length) {
      return NextResponse.json({
        error: 'Parser found 0 line items',
        header,
        text_snippet: (raw_text || '').slice(0, 2000),
      }, { status: 422 });
    }

    // Persist.
    const vendorId = await ensureVendor(admin, header.vendor_name);

    // Guard: skip invoice if we've already ingested its number.
    if (header.invoice_number) {
      const { data: dup } = await admin
        .from('invoices')
        .select('id')
        .eq('invoice_number', header.invoice_number)
        .eq('vendor_id', vendorId)
        .limit(1);
      if (dup && dup[0]) {
        return NextResponse.json({
          error: 'Invoice already ingested',
          duplicate: true,
          invoice_id: dup[0].id,
          invoice_number: header.invoice_number,
        }, { status: 409 });
      }
    }

    // Invoices require a store_id (NOT NULL). If caller didn't pass one,
    // pick the first active store — owner-level data anyway.
    let resolvedStoreId = storeId;
    if (!resolvedStoreId) {
      const { data: s } = await admin.from('stores').select('id').eq('is_active', true).order('created_at').limit(1);
      resolvedStoreId = s?.[0]?.id || null;
    }

    const { data: inv, error: invErr } = await admin
      .from('invoices')
      .insert({
        store_id: resolvedStoreId,
        vendor_id: vendorId,
        vendor_name: header.vendor_name,
        invoice_number: header.invoice_number,
        date: header.invoice_date || new Date().toISOString().slice(0, 10),
        amount: header.grand_total || 0,
        subtotal: header.subtotal || null,
        total_discount: header.total_discount || null,
        parse_source: header.parse_source,
        parsed_at: new Date().toISOString(),
        uploaded_by: user.id,
        image_url: '',   // PDF storage upload can be wired later
        image_path: '',
      })
      .select('id')
      .single();
    if (invErr) throw invErr;

    // Line items → products + product_prices.
    const priceRows = [];
    for (const item of items) {
      const productId = await ensureProduct(admin, item);
      priceRows.push({
        product_id: productId,
        vendor_id: vendorId,
        vendor_name: header.vendor_name,
        invoice_id: inv.id,
        invoice_number: header.invoice_number,
        invoice_date: header.invoice_date || new Date().toISOString().slice(0, 10),
        quantity: item.quantity,
        sold_unit_price: item.sold_unit_price,
        line_discount: item.line_discount || 0,
        unit_price: item.unit_price,
        raw_description: item.description,
      });
    }
    const { error: priceErr } = await admin.from('product_prices').insert(priceRows);
    if (priceErr) throw priceErr;

    return NextResponse.json({
      ok: true,
      invoice_id: inv.id,
      invoice_number: header.invoice_number,
      vendor: header.vendor_name,
      items_ingested: priceRows.length,
      grand_total: header.grand_total,
      header,
    });
  } catch (e) {
    console.error('[warehouse-prices/ingest]', e);
    return NextResponse.json({ error: e.message || 'Ingest failed' }, { status: 500 });
  }
}
