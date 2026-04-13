-- ═══════════════════════════════════════════════════════════
-- Make invoices.purchase_id cascade on delete so deleting a
-- purchase automatically removes the invoice row.
-- Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_purchase_id_fkey;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_purchase_id_fkey
  FOREIGN KEY (purchase_id)
  REFERENCES purchases(id)
  ON DELETE CASCADE;
