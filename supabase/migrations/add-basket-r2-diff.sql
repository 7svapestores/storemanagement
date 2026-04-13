-- ═══════════════════════════════════════════════════════════
-- Add a display-friendly basket_r2_diff column:
--   basket_r2_diff = r2_net - r1_canceled_basket
--   (negative = money missing, positive = extra money)
--
-- total_short keeps the previous math. Internally the trigger
-- subtracts basket_r2_diff (equivalent to adding
-- canceled_basket - r2_net) so that a missing-money diff
-- still INCREASES the total short.
-- Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS basket_r2_diff numeric(12,2) DEFAULT 0;

CREATE OR REPLACE FUNCTION calc_sales_totals()
RETURNS trigger AS $$
BEGIN
  new.r1_short_over = coalesce(new.cash_sales, 0) - coalesce(new.r1_safe_drop, 0);
  new.r2_short_over = coalesce(new.r2_net,     0) - coalesce(new.r2_safe_drop, 0);

  -- Display diff: negative = money missing.
  new.basket_r2_diff = coalesce(new.r2_net, 0) - coalesce(new.r1_canceled_basket, 0);

  -- Total short/over. We subtract the display diff so "missing money"
  -- (negative diff) contributes positively to the total short.
  new.short_over = coalesce(new.r1_short_over, 0)
                 + coalesce(new.r2_short_over, 0)
                 - coalesce(new.basket_r2_diff, 0);

  new.gross_sales = coalesce(new.r1_gross, 0) + coalesce(new.r2_net, 0);
  new.net_sales   = coalesce(new.r1_net,   0) + coalesce(new.r2_net, 0);

  new.total_sales = coalesce(new.cash_sales,    0)
                  + coalesce(new.card_sales,    0)
                  + coalesce(new.register2_cash, 0);

  new.tax_collected = coalesce(new.r1_sales_tax, 0);
  new.r2_gross      = coalesce(new.r2_net, 0);

  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- Backfill the new column for existing rows.
UPDATE daily_sales
SET basket_r2_diff = coalesce(r2_net, 0) - coalesce(r1_canceled_basket, 0);
