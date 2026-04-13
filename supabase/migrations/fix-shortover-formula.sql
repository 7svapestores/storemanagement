-- ═══════════════════════════════════════════════════════════
-- Short/over now uses the "positive = short" convention and
-- includes the basket vs R2 difference in the total.
--
--   r1_short_over = cash_sales - r1_safe_drop
--   r2_short_over = r2_net - r2_safe_drop
--   basket_r2_diff = r1_canceled_basket - r2_net
--   short_over    = r1_short_over + r2_short_over + basket_r2_diff
--
-- Positive = employee is SHORT (owes money).
-- Negative = employee is OVER (extra cash).
-- Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION calc_sales_totals()
RETURNS trigger AS $$
DECLARE
  basket_diff numeric(12,2);
BEGIN
  new.r1_short_over = coalesce(new.cash_sales, 0) - coalesce(new.r1_safe_drop, 0);
  new.r2_short_over = coalesce(new.r2_net,     0) - coalesce(new.r2_safe_drop, 0);

  basket_diff = coalesce(new.r1_canceled_basket, 0) - coalesce(new.r2_net, 0);

  new.short_over = coalesce(new.r1_short_over, 0)
                 + coalesce(new.r2_short_over, 0)
                 + basket_diff;

  new.gross_sales = coalesce(new.r1_gross, 0) + coalesce(new.r2_net, 0);
  new.net_sales   = coalesce(new.r1_net,   0) + coalesce(new.r2_net, 0);

  new.total_sales = coalesce(new.cash_sales,    0)
                  + coalesce(new.card_sales,    0)
                  + coalesce(new.register2_cash, 0);

  new.tax_collected = coalesce(new.r1_sales_tax, 0);

  new.r2_gross = coalesce(new.r2_net, 0);

  RETURN new;
END;
$$ LANGUAGE plpgsql;
