-- Add expense_date column for daily granularity (month column kept for backward compat)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_date DATE;

-- Backfill existing rows using created_at
UPDATE expenses SET expense_date = DATE(created_at) WHERE expense_date IS NULL;

-- Index for date range filtering
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date DESC);
