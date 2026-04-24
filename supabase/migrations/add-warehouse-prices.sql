-- ═══════════════════════════════════════════════════════════
-- Warehouse Prices: product catalog + cross-warehouse price history
-- so we can suggest the cheapest warehouse per SKU.
--
-- Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Master product catalog ──────────────────────────────
-- One row per distinct SKU. Multiple warehouses can reference
-- the same product row via product_prices.
CREATE TABLE IF NOT EXISTS products (
  id            uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  upc           text UNIQUE,                    -- primary identifier when known
  aliases       text[] DEFAULT '{}',            -- alternative UPCs/barcodes
  name          text NOT NULL,                  -- canonical display name
  brand         text,                           -- parsed brand when possible
  variant       text,                           -- flavor / color / strain
  category      text,                           -- Vapes, Pre Rolls, Gummies…
  search_blob   text GENERATED ALWAYS AS (
                  lower(coalesce(name,'') || ' ' || coalesce(brand,'') || ' ' ||
                        coalesce(variant,'') || ' ' || coalesce(upc,''))
                ) STORED,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_upc     ON products(upc);
CREATE INDEX IF NOT EXISTS idx_products_search  ON products USING gin (to_tsvector('simple', search_blob));
CREATE INDEX IF NOT EXISTS idx_products_name    ON products(lower(name));

-- ── 2. Per-invoice price history ───────────────────────────
-- Every invoice line becomes one row. Keeps raw + effective
-- unit price (after line discount) so we can show true cost.
CREATE TABLE IF NOT EXISTS product_prices (
  id                 uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  product_id         uuid REFERENCES products(id) ON DELETE CASCADE NOT NULL,
  vendor_id          uuid REFERENCES vendors(id),
  vendor_name        text NOT NULL,               -- denormalized for fast filtering
  invoice_id         uuid REFERENCES invoices(id) ON DELETE SET NULL,
  invoice_number     text,                        -- e.g. 'INV/DAL/2026/01644'
  invoice_date       date NOT NULL,
  quantity           numeric(12,2) NOT NULL,
  sold_unit_price    numeric(12,2) NOT NULL,      -- price printed on the invoice
  line_discount      numeric(12,2) DEFAULT 0,     -- line-item D/C
  unit_price         numeric(12,2) NOT NULL,      -- effective = sold - (disc/qty)
  raw_description    text,                        -- original invoice line text
  created_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_prices_product   ON product_prices(product_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_product_prices_vendor    ON product_prices(vendor_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_product_prices_date      ON product_prices(invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_product_prices_invoice   ON product_prices(invoice_id);

-- ── 3. Extend invoices with parsing metadata ───────────────
-- Existing invoices table is image-backed; we reuse it for PDFs
-- and add a few fields for parser output.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_number text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtotal       numeric(12,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total_discount numeric(12,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS parse_source   text;  -- 'rave' | 'nepa' | 'manual' | 'llm'
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS parsed_at      timestamptz;

CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);

-- ── 4. Best-price helper view ──────────────────────────────
-- Quickest-to-cheapest view: for every product, one row per
-- vendor with the most recent unit_price and last-bought date.
CREATE OR REPLACE VIEW product_best_prices AS
SELECT DISTINCT ON (pp.product_id, pp.vendor_id)
  pp.product_id,
  pp.vendor_id,
  pp.vendor_name,
  pp.unit_price,
  pp.invoice_date AS last_bought,
  pp.invoice_number,
  pp.quantity
FROM product_prices pp
ORDER BY pp.product_id, pp.vendor_id, pp.invoice_date DESC;

-- RLS disabled in line with the rest of the schema.
ALTER TABLE products       DISABLE ROW LEVEL SECURITY;
ALTER TABLE product_prices DISABLE ROW LEVEL SECURITY;
