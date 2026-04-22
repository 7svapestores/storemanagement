-- Update the calc_sales_totals trigger to include non_tax_sales in total_sales
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
  new.total_sales = coalesce(new.net_sales, 0) + coalesce(new.non_tax_sales, 0);

  RETURN new;
END;
$$ LANGUAGE plpgsql;
