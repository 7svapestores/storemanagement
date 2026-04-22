-- ═══════════════════════════════════════════════════════════
-- Make calc_sales_totals aware of stores.has_register2:
--   1. For R2 stores, auto-mirror R2 Net / Gross / Cash from R1 Canceled
--      Basket (cash canceled in R1 is re-rung on the manual R2 register).
--   2. Only include basket_diff in short_over for R2 stores. For
--      single-register stores, cancellations are operational (scan error,
--      customer changed mind) and are NOT a cash discrepancy.
-- Run in Supabase SQL Editor. Safe to re-run.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION calc_sales_totals()
RETURNS trigger AS $$
DECLARE
  uses_r2 boolean;
  basket_diff numeric(12,2);
BEGIN
  SELECT has_register2 INTO uses_r2 FROM stores WHERE id = new.store_id;
  uses_r2 := coalesce(uses_r2, false);

  -- R2 auto-mirror: R2 always equals the canceled basket for manual-R2 stores.
  IF uses_r2 THEN
    new.r2_net        = coalesce(new.r1_canceled_basket, 0);
    new.r2_gross      = coalesce(new.r1_canceled_basket, 0);
    new.register2_cash = coalesce(new.r1_canceled_basket, 0);
  END IF;

  new.r1_short_over = coalesce(new.cash_sales, 0) - coalesce(new.r1_safe_drop, 0);
  new.r2_short_over = coalesce(new.r2_net,     0) - coalesce(new.r2_safe_drop, 0);

  basket_diff = coalesce(new.r1_canceled_basket, 0) - coalesce(new.r2_net, 0);

  new.short_over = coalesce(new.r1_short_over, 0)
                 + coalesce(new.r2_short_over, 0)
                 + CASE WHEN uses_r2 THEN basket_diff ELSE 0 END;

  new.gross_sales = coalesce(new.r1_gross, 0) + coalesce(new.r2_net, 0);
  new.net_sales   = coalesce(new.r1_net,   0) + coalesce(new.r2_net, 0);
  new.total_sales = coalesce(new.net_sales, 0) + coalesce(new.non_tax_sales, 0);

  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- Recompute every row so existing short_over values pick up the new formula.
UPDATE daily_sales SET id = id;
