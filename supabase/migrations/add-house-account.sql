-- ═══════════════════════════════════════════════════════════
-- Replace Register 1 "Credits" with "House Account" — a named
-- running tab (Billy / Elias / Other) plus an amount.
--
--   r1_short_over = cash_sales - (r1_safe_drop + r1_house_account_amount)
--
-- credits is kept in sync with r1_house_account_amount for
-- backward compatibility with existing reports/dashboards.
-- Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS r1_house_account_name   text;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS r1_house_account_amount numeric(12,2) DEFAULT 0;

CREATE OR REPLACE FUNCTION calc_sales_totals()
RETURNS trigger AS $$
BEGIN
  -- Keep the legacy credits column in sync so reports still work.
  new.credits = coalesce(new.r1_house_account_amount, 0);

  new.r1_short_over = coalesce(new.cash_sales, 0)
                    - (coalesce(new.r1_safe_drop, 0) + coalesce(new.r1_house_account_amount, 0));
  new.r2_short_over = coalesce(new.r2_net,     0) - coalesce(new.r2_safe_drop, 0);

  new.basket_r2_diff = coalesce(new.r2_net, 0) - coalesce(new.r1_canceled_basket, 0);

  new.short_over = coalesce(new.r1_short_over, 0) + coalesce(new.r2_short_over, 0);

  new.gross_sales = coalesce(new.r1_gross, 0) + coalesce(new.r2_net, 0);
  new.net_sales   = coalesce(new.r1_net,   0) + coalesce(new.r2_net, 0);
  new.total_sales = coalesce(new.cash_sales, 0) + coalesce(new.card_sales, 0) + coalesce(new.register2_cash, 0);
  new.tax_collected = coalesce(new.r1_sales_tax, 0);
  new.r2_gross      = coalesce(new.r2_net, 0);

  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- Backfill existing rows: seed house_account_amount from credits so nothing disappears.
UPDATE daily_sales
SET r1_house_account_amount = coalesce(credits, 0)
WHERE r1_house_account_amount IS NULL OR r1_house_account_amount = 0;
