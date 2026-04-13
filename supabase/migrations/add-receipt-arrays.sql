-- ═══════════════════════════════════════════════════════════
-- Multiple receipt images per register on daily_sales.
-- Keeps the legacy shift_report_url / safe_drop_url columns
-- for backward compat with older rows.
-- Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS r1_receipt_urls jsonb DEFAULT '[]'::jsonb;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS r2_receipt_urls jsonb DEFAULT '[]'::jsonb;
