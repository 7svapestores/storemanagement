-- ═══════════════════════════════════════════════════════════
-- Manual gross/net per register + short/over per register.
-- Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS r1_gross          numeric(12,2) DEFAULT 0;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS r1_net            numeric(12,2) DEFAULT 0;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS r2_gross          numeric(12,2) DEFAULT 0;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS r2_net            numeric(12,2) DEFAULT 0;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS register2_credits numeric(12,2) DEFAULT 0;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS r1_short_over     numeric(12,2) DEFAULT 0;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS r2_short_over     numeric(12,2) DEFAULT 0;

-- Replace the trigger:
--   gross_sales / net_sales come from what the employee DECLARED per register
--     (sum of r1_*, r2_*). They are no longer auto-derived from cash+card.
--   total_sales stays in sync with the actual cash+card sum across both
--     registers (the "real" money) so reports/dashboard queries that read
--     total_sales still mean what they used to mean.
--   short_over rolls up from r1 + r2.
--   tax_collected is computed off declared gross_sales.
CREATE OR REPLACE FUNCTION calc_sales_totals()
RETURNS trigger AS $$
BEGIN
  new.gross_sales = coalesce(new.r1_gross, 0) + coalesce(new.r2_gross, 0);
  new.net_sales   = coalesce(new.r1_net,   0) + coalesce(new.r2_net,   0);

  new.total_sales = coalesce(new.cash_sales,    0)
                  + coalesce(new.card_sales,    0)
                  + coalesce(new.register2_cash, 0)
                  + coalesce(new.register2_card, 0);

  new.short_over  = coalesce(new.r1_short_over, 0) + coalesce(new.r2_short_over, 0);

  SELECT tax_rate INTO new.tax_collected FROM stores WHERE id = new.store_id;
  new.tax_collected = new.gross_sales * coalesce(new.tax_collected, 0.0825);

  RETURN new;
END;
$$ LANGUAGE plpgsql;
