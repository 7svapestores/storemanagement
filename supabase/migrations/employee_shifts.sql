-- Employee shifts extracted from NRS session data
CREATE TABLE IF NOT EXISTS employee_shifts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  shift_date date NOT NULL,
  employee_name text NOT NULL,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  total_hours numeric(5,2),
  nrs_session_id bigint,
  nrs_terminal_id bigint,
  nrs_login_id bigint,
  daily_sales_id uuid REFERENCES daily_sales(id) ON DELETE CASCADE,
  synced_at timestamptz DEFAULT now(),
  UNIQUE(nrs_session_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_shifts_date ON employee_shifts(shift_date DESC);
CREATE INDEX IF NOT EXISTS idx_employee_shifts_employee ON employee_shifts(employee_name);
CREATE INDEX IF NOT EXISTS idx_employee_shifts_store ON employee_shifts(store_id);
ALTER TABLE employee_shifts DISABLE ROW LEVEL SECURITY;
