-- ═══════════════════════════════════════════════════════════
-- Daily sales: add Register 2, gross/net, short/over
-- Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS register2_cash numeric(12,2) DEFAULT 0;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS register2_card numeric(12,2) DEFAULT 0;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS gross_sales    numeric(12,2) DEFAULT 0;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS net_sales      numeric(12,2) DEFAULT 0;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS short_over     numeric(12,2) DEFAULT 0;

-- Update the calc trigger to compute gross/net automatically and keep
-- total_sales pointed at gross_sales for backward compat with existing code.
CREATE OR REPLACE FUNCTION calc_sales_totals()
RETURNS trigger AS $$
BEGIN
  new.gross_sales = coalesce(new.cash_sales, 0)
                  + coalesce(new.card_sales, 0)
                  + coalesce(new.register2_cash, 0)
                  + coalesce(new.register2_card, 0);

  new.net_sales   = new.gross_sales - coalesce(new.credits, 0);

  -- total_sales kept in sync with gross_sales so reports/dashboard queries
  -- that still read total_sales continue to work.
  new.total_sales = new.gross_sales;

  SELECT tax_rate INTO new.tax_collected FROM stores WHERE id = new.store_id;
  new.tax_collected = new.gross_sales * coalesce(new.tax_collected, 0.0825);
  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- Backfill existing rows so gross/net reflect current cash+card.
UPDATE daily_sales
SET gross_sales = coalesce(cash_sales, 0) + coalesce(card_sales, 0)
                + coalesce(register2_cash, 0) + coalesce(register2_card, 0),
    net_sales   = coalesce(cash_sales, 0) + coalesce(card_sales, 0)
                + coalesce(register2_cash, 0) + coalesce(register2_card, 0)
                - coalesce(credits, 0);
