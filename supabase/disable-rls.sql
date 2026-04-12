-- ═══════════════════════════════════════════════════════════
-- PERMANENT FIX: Disable RLS on every app table and drop all
-- existing policies. Authorization is handled in app code.
-- Run this in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE profiles         DISABLE ROW LEVEL SECURITY;
ALTER TABLE stores           DISABLE ROW LEVEL SECURITY;
ALTER TABLE daily_sales      DISABLE ROW LEVEL SECURITY;
ALTER TABLE cash_collections DISABLE ROW LEVEL SECURITY;
ALTER TABLE purchases        DISABLE ROW LEVEL SECURITY;
ALTER TABLE expenses         DISABLE ROW LEVEL SECURITY;
ALTER TABLE inventory        DISABLE ROW LEVEL SECURITY;
ALTER TABLE vendors          DISABLE ROW LEVEL SECURITY;
ALTER TABLE email_settings   DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log     DISABLE ROW LEVEL SECURITY;

-- Drop every policy left on any table in the public schema.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END
$$;
