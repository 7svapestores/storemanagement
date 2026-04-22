-- Fix total_sales for ALL rows: total_sales = net_sales + non_tax_sales
-- This corrects rows where total_sales was incorrectly set to gross_sales
UPDATE daily_sales
SET total_sales = COALESCE(net_sales, 0) + COALESCE(non_tax_sales, 0);

-- Verify (run separately):
-- SELECT s.name, ds.date, ds.gross_sales, ds.net_sales, ds.non_tax_sales, ds.total_sales
-- FROM daily_sales ds JOIN stores s ON s.id = ds.store_id
-- WHERE ds.date >= '2026-04-18' ORDER BY ds.date DESC, s.name;
