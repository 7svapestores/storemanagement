-- ═══════════════════════════════════════════════════════════
-- Store the AI's raw reading alongside the computed mismatches,
-- and let the owner attach a review note + mark as reviewed.
-- Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS ai_extracted_data jsonb;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS owner_review_note text;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS owner_reviewed_at timestamptz;
ALTER TABLE daily_sales ADD COLUMN IF NOT EXISTS owner_reviewed_by uuid REFERENCES auth.users(id);
