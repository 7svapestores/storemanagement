-- ═══════════════════════════════════════════════════════════
-- New register fields: canceled basket, safe drop, sales tax,
-- plus R2 safe drop. Short/over is now derived from safe drop
-- vs cash (not entered manually).
-- Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS r1_canceled_basket numeric(12,2) DEFAULT 0;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS r1_safe_drop       numeric(12,2) DEFAULT 0;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS r1_sales_tax       numeric(12,2) DEFAULT 0;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS r2_safe_drop       numeric(12,2) DEFAULT 0;

-- Replace the trigger:
--   r1_short_over = r1_safe_drop - cash_sales            (derived)
--   r2_short_over = r2_safe_drop - register2_cash        (derived)
--   short_over    = r1_short_over + r2_short_over
--
--   gross_sales = r1_gross + r2_net   (R2 has no separate gross)
--   net_sales   = r1_net + r2_net
--   total_sales = cash_sales + card_sales + register2_cash
--   tax_collected = r1_sales_tax (employee reads from register tape)
CREATE OR REPLACE FUNCTION calc_sales_totals()
RETURNS trigger AS $$
BEGIN
  new.r1_short_over = coalesce(new.r1_safe_drop, 0)    - coalesce(new.cash_sales,    0);
  new.r2_short_over = coalesce(new.r2_safe_drop, 0)    - coalesce(new.register2_cash, 0);
  new.short_over    = coalesce(new.r1_short_over, 0)   + coalesce(new.r2_short_over, 0);

  new.gross_sales = coalesce(new.r1_gross, 0) + coalesce(new.r2_net, 0);
  new.net_sales   = coalesce(new.r1_net,   0) + coalesce(new.r2_net, 0);

  new.total_sales = coalesce(new.cash_sales,    0)
                  + coalesce(new.card_sales,    0)
                  + coalesce(new.register2_cash, 0);

  -- Trust the employee-entered sales tax from the register tape.
  new.tax_collected = coalesce(new.r1_sales_tax, 0);

  -- Keep r2_gross in sync with r2_net so legacy code that reads r2_gross
  -- still sees a sane value.
  new.r2_gross = coalesce(new.r2_net, 0);

  RETURN new;
END;
$$ LANGUAGE plpgsql;
