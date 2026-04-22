-- Add non_tax_sales column to daily_sales
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS non_tax_sales NUMERIC(12,2) DEFAULT 0;

-- Update total_sales for existing rows: total_sales = net_sales + non_tax_sales
-- (non_tax_sales defaults to 0 so total_sales = net_sales for old rows)
UPDATE daily_sales SET total_sales = COALESCE(net_sales, 0) + COALESCE(non_tax_sales, 0)
WHERE total_sales IS NULL OR total_sales = 0 OR total_sales = gross_sales;
