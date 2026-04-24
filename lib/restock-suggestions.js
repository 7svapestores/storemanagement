// Cheapest-vendor suggestion helper.
//
// Given a list of cart items (product_name / upc / variant / qty), find the
// cheapest unit price for each across all recorded vendor invoices and return
// the suggestion plus alternatives.
//
// Match priority per item:
//   1. exact UPC match
//   2. exact product_name + variant match (case-insensitive)
//   3. fuzzy product_name ILIKE match
//
// "Cheapest" uses the same aggregation as the warehouse-prices UI:
//   - group by (product_id, vendor_id), keep the MIN unit_price per group
//   - then pick the MIN across vendors for the final suggestion
// so the number here matches what the "All products" table shows.
//
// Pure — takes a supabase client (typically admin-scoped) and items, returns
// data. No side effects.

const norm = (s) => String(s || '').trim().toLowerCase();

// Fetch every product_prices row for the given product ids, joined with the
// invoice (so we can deep-link the PDF) and aggregated to one offer per
// (product, vendor) with the LOWEST unit_price as the winning row.
async function offersForProductIds(supabase, productIds) {
  if (!productIds.length) return new Map();
  const { data: rows, error } = await supabase
    .from('product_prices')
    .select(`
      product_id,
      vendor_id,
      vendor_name,
      unit_price,
      invoice_id,
      invoice_number,
      invoice_date,
      invoices ( image_url )
    `)
    .in('product_id', productIds)
    .order('invoice_date', { ascending: false });
  if (error) throw error;

  const byKey = new Map(); // "product:vendor" -> best row
  for (const r of rows || []) {
    const key = `${r.product_id}:${r.vendor_id || 'null'}`;
    const existing = byKey.get(key);
    if (!existing || Number(r.unit_price) < Number(existing.unit_price)) {
      byKey.set(key, r);
    }
  }

  // Group offers per product, sorted cheapest first.
  const byProduct = new Map();
  for (const row of byKey.values()) {
    const offer = {
      vendor_id: row.vendor_id,
      vendor_name: row.vendor_name,
      unit_price: Number(row.unit_price),
      invoice_id: row.invoice_id,
      invoice_number: row.invoice_number,
      invoice_date: row.invoice_date,
      invoice_url: row.invoices?.image_url || null,
    };
    const list = byProduct.get(row.product_id) || [];
    list.push(offer);
    byProduct.set(row.product_id, list);
  }
  for (const list of byProduct.values()) {
    list.sort((a, b) => a.unit_price - b.unit_price);
  }
  return byProduct;
}

// Resolve a single cart item to a product id. Returns null when nothing
// matches — the caller treats that as "no suggestion".
async function resolveProductId(supabase, item) {
  // 1. Exact UPC
  if (item.upc) {
    const { data } = await supabase
      .from('products')
      .select('id')
      .eq('upc', item.upc)
      .limit(1);
    if (data?.[0]) return data[0].id;
  }

  // 2. Exact name + variant (case-insensitive)
  const name = norm(item.product_name);
  const variant = norm(item.variant);
  if (name) {
    let q = supabase.from('products').select('id, name, variant').ilike('name', item.product_name);
    if (variant) q = q.ilike('variant', item.variant);
    const { data } = await q.limit(1);
    if (data?.[0]) return data[0].id;
  }

  // 3. Fuzzy name — first token match, shortest name wins (least specific
  // inflation). Supabase ilike wraps with '%' so we only add them once.
  if (name) {
    const { data } = await supabase
      .from('products')
      .select('id, name')
      .ilike('name', `%${item.product_name}%`)
      .limit(5);
    if (data?.length) {
      data.sort((a, b) => (a.name || '').length - (b.name || '').length);
      return data[0].id;
    }
  }

  return null;
}

// items: [{ product_name, upc, variant, qty }]
// returns: [{ ...item, suggested_vendor, suggested_unit_price,
//              suggested_invoice_id, alternatives: [top 3 offers] }]
export async function getSuggestionsForItems(supabase, items) {
  if (!Array.isArray(items) || !items.length) return [];

  const resolved = [];
  for (const item of items) {
    const product_id = await resolveProductId(supabase, item);
    resolved.push({ item, product_id });
  }

  const productIds = Array.from(new Set(resolved.map(r => r.product_id).filter(Boolean)));
  const offersByProduct = await offersForProductIds(supabase, productIds);

  return resolved.map(({ item, product_id }) => {
    const offers = product_id ? (offersByProduct.get(product_id) || []) : [];
    const best = offers[0] || null;
    return {
      ...item,
      suggested_vendor: best?.vendor_name || null,
      suggested_unit_price: best ? Number(best.unit_price) : null,
      suggested_invoice_id: best?.invoice_id || null,
      alternatives: offers.slice(0, 3).map(o => ({
        vendor_id: o.vendor_id,
        vendor_name: o.vendor_name,
        unit_price: o.unit_price,
        invoice_id: o.invoice_id,
        invoice_number: o.invoice_number,
        invoice_date: o.invoice_date,
        invoice_url: o.invoice_url,
      })),
    };
  });
}

// Given a single product name/upc/variant, return every vendor that carries
// it with their lowest seen unit_price. Used by the owner review page so
// vendor overrides come from the set of warehouses actually stocking the SKU.
export async function getVendorOptionsFor(supabase, { product_name, upc, variant }) {
  const product_id = await resolveProductId(supabase, { product_name, upc, variant });
  if (!product_id) return [];
  const byProduct = await offersForProductIds(supabase, [product_id]);
  return byProduct.get(product_id) || [];
}
