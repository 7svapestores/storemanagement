-- ═══════════════════════════════════════════════════════════
-- Add cashapp_check column to daily_sales and include it
-- in the total_sales calculation.
-- Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS cashapp_check numeric(12,2) DEFAULT 0;

CREATE OR REPLACE FUNCTION calc_sales_totals()
RETURNS trigger AS $$
BEGIN
  -- Keep the legacy credits column in sync with house account amount.
  new.credits = coalesce(new.r1_house_account_amount, 0);

  new.r1_short_over = coalesce(new.cash_sales, 0)
                    - (coalesce(new.r1_safe_drop, 0) + coalesce(new.r1_house_account_amount, 0));
  new.r2_short_over = coalesce(new.r2_net, 0) - coalesce(new.r2_safe_drop, 0);

  new.basket_r2_diff = coalesce(new.r2_net, 0) - coalesce(new.r1_canceled_basket, 0);

  new.short_over = coalesce(new.r1_short_over, 0) + coalesce(new.r2_short_over, 0);

  new.gross_sales = coalesce(new.r1_gross, 0) + coalesce(new.r2_net, 0);
  new.net_sales   = coalesce(new.r1_net,   0) + coalesce(new.r2_net, 0);

  -- Includes cashapp_check as a tender type.
  new.total_sales = coalesce(new.cash_sales, 0)
                  + coalesce(new.card_sales, 0)
                  + coalesce(new.cashapp_check, 0)
                  + coalesce(new.register2_cash, 0);

  new.tax_collected = coalesce(new.r1_sales_tax, 0);
  new.r2_gross      = coalesce(new.r2_net, 0);

  RETURN new;
END;
$$ LANGUAGE plpgsql;
