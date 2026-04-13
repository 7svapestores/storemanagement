-- ═══════════════════════════════════════════════════════════
-- Receipt verification columns on daily_sales.
-- Run in Supabase SQL Editor.
-- Then create the 'receipts' storage bucket:
--   Storage > New bucket > name=receipts, public=YES,
--   file size limit=10MB, allowed mime=image/jpeg, image/png, image/webp
-- ═══════════════════════════════════════════════════════════

ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS shift_report_url    text;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS shift_report_path   text;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS safe_drop_url       text;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS safe_drop_path      text;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS ai_verified         boolean DEFAULT false;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS ai_mismatches       jsonb;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS ai_override_note    text;
