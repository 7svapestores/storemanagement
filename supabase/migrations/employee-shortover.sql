-- ═══════════════════════════════════════════════════════════
-- Employee short/over ledger for payroll deduction tracking.
-- Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_shortover (
  id              uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  employee_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  employee_name   text,
  store_id        uuid REFERENCES stores(id),
  sales_id        uuid REFERENCES daily_sales(id) ON DELETE CASCADE,
  date            date NOT NULL,
  r1_short        numeric(12,2) DEFAULT 0,
  r2_short        numeric(12,2) DEFAULT 0,
  total_short     numeric(12,2) DEFAULT 0,
  deducted        boolean DEFAULT false,
  deducted_at     timestamptz,
  deducted_by     uuid REFERENCES auth.users(id),
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (sales_id)
);

CREATE INDEX IF NOT EXISTS idx_empshort_employee ON employee_shortover(employee_id);
CREATE INDEX IF NOT EXISTS idx_empshort_store    ON employee_shortover(store_id);
CREATE INDEX IF NOT EXISTS idx_empshort_date     ON employee_shortover(date DESC);
CREATE INDEX IF NOT EXISTS idx_empshort_deducted ON employee_shortover(deducted);

ALTER TABLE employee_shortover DISABLE ROW LEVEL SECURITY;

-- Auto-update updated_at on row change.
DROP TRIGGER IF EXISTS tr_empshort_updated ON employee_shortover;
CREATE TRIGGER tr_empshort_updated BEFORE UPDATE ON employee_shortover
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
