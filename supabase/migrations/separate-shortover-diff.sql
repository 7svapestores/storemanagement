-- ═══════════════════════════════════════════════════════════
-- Short/over and basket_r2_diff are now independent columns:
--   short_over     = r1_short_over + r2_short_over   (no basket)
--   basket_r2_diff = r2_net - r1_canceled_basket
-- Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION calc_sales_totals()
RETURNS trigger AS $$
BEGIN
  new.r1_short_over = coalesce(new.cash_sales, 0) - coalesce(new.r1_safe_drop, 0);
  new.r2_short_over = coalesce(new.r2_net,     0) - coalesce(new.r2_safe_drop, 0);

  new.basket_r2_diff = coalesce(new.r2_net, 0) - coalesce(new.r1_canceled_basket, 0);

  -- Short/over now counts ONLY the register short/overs. The basket
  -- vs R2 difference is reported separately.
  new.short_over = coalesce(new.r1_short_over, 0) + coalesce(new.r2_short_over, 0);

  new.gross_sales = coalesce(new.r1_gross, 0) + coalesce(new.r2_net, 0);
  new.net_sales   = coalesce(new.r1_net,   0) + coalesce(new.r2_net, 0);
  new.total_sales = coalesce(new.cash_sales, 0) + coalesce(new.card_sales, 0) + coalesce(new.register2_cash, 0);
  new.tax_collected = coalesce(new.r1_sales_tax, 0);
  new.r2_gross      = coalesce(new.r2_net, 0);

  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- Backfill existing rows so their stored short_over matches the new formula.
UPDATE daily_sales
SET short_over = coalesce(r1_short_over, 0) + coalesce(r2_short_over, 0);
