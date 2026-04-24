-- ═══════════════════════════════════════════════════════════
-- Restock Requests: employees build a cart of what their store
-- needs, the system freezes the cheapest-vendor suggestion per
-- item, and the owner reviews, edits, approves, and exports a
-- per-vendor PO.
--
-- Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Request header ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS restock_requests (
  id          uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES auth.users(id),
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','ordered','cancelled')),
  note        text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restock_requests_store_status
  ON restock_requests(store_id, status);
CREATE INDEX IF NOT EXISTS idx_restock_requests_created_by
  ON restock_requests(created_by, created_at DESC);

-- ── 2. Request line items ──────────────────────────────────
-- Suggestions are frozen into the row at submission time so a
-- later invoice ingest can't silently re-rank an approved PO.
CREATE TABLE IF NOT EXISTS restock_request_items (
  id                    uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  request_id            uuid NOT NULL REFERENCES restock_requests(id) ON DELETE CASCADE,
  product_name          text NOT NULL,
  upc                   text,
  variant               text,
  qty                   integer NOT NULL CHECK (qty > 0),
  suggested_vendor      text,
  suggested_unit_price  numeric(10,2),
  suggested_invoice_id  uuid REFERENCES invoices(id) ON DELETE SET NULL,
  override_vendor       text,
  override_unit_price   numeric(10,2),
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restock_request_items_request
  ON restock_request_items(request_id);

-- ── 3. updated_at trigger ──────────────────────────────────
CREATE OR REPLACE FUNCTION set_restock_requests_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_restock_requests_updated_at ON restock_requests;
CREATE TRIGGER trg_restock_requests_updated_at
  BEFORE UPDATE ON restock_requests
  FOR EACH ROW EXECUTE FUNCTION set_restock_requests_updated_at();

-- ── 4. RLS ─────────────────────────────────────────────────
-- RLS is disabled across the app (see add-warehouse-prices.sql and
-- add-invoices.sql). Authorization — "employees only see/mutate
-- pending requests for their own store" and "only owners can
-- approve / order / delete" — is enforced in the API routes via
-- createClient() + profile.role + profile.store_id checks.
ALTER TABLE restock_requests       DISABLE ROW LEVEL SECURITY;
ALTER TABLE restock_request_items  DISABLE ROW LEVEL SECURITY;
