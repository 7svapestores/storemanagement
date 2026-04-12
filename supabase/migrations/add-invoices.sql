-- ═══════════════════════════════════════════════════════════
-- Invoices: image-backed receipts attached to purchases.
-- Run in Supabase SQL Editor.
-- Then create the storage bucket — see instructions in the
-- accompanying note (Storage > New Bucket > "invoices", public).
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS invoices (
  id           uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  store_id     uuid REFERENCES stores(id) NOT NULL,
  vendor_id    uuid REFERENCES vendors(id),
  vendor_name  text NOT NULL,
  purchase_id  uuid REFERENCES purchases(id) ON DELETE SET NULL,
  image_url    text NOT NULL,
  image_path   text NOT NULL,
  date         date NOT NULL,
  amount       numeric(12,2) DEFAULT 0,
  notes        text,
  uploaded_by  uuid REFERENCES auth.users(id),
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_store  ON invoices(store_id);
CREATE INDEX IF NOT EXISTS idx_invoices_vendor ON invoices(vendor_name);
CREATE INDEX IF NOT EXISTS idx_invoices_date   ON invoices(date DESC);

-- RLS is currently disabled across the app. If you re-enable it later,
-- the same auth-in-app pattern applies — no recursive policies.
ALTER TABLE invoices DISABLE ROW LEVEL SECURITY;
