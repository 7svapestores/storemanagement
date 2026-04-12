-- ═══════════════════════════════════════════════════════════
-- Activity Log / Audit Trail
-- Run this in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS activity_log (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name text,
  user_role text,
  action text NOT NULL,              -- 'create' | 'update' | 'delete'
  entity_type text NOT NULL,         -- 'daily_sales' | 'cash_collection' | ...
  entity_id uuid,
  description text NOT NULL,
  metadata jsonb,
  store_name text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_user       ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity     ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_action     ON activity_log(action);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can INSERT their own log row (so employees can log
-- their own sales entries). The user_id/user_name columns are filled by the
-- client using auth.uid() / profile.
DROP POLICY IF EXISTS "Anyone can insert activity"   ON activity_log;
DROP POLICY IF EXISTS "Owners can view activity"     ON activity_log;

CREATE POLICY "Anyone can insert activity"
  ON activity_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Only owners can read the audit trail.
CREATE POLICY "Owners can view activity"
  ON activity_log FOR SELECT
  USING (is_owner());
