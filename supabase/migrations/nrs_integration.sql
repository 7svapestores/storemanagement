-- NRS POS Integration
-- Adds NRS store IDs to stores table and creates sync log table

-- Add NRS columns to stores
ALTER TABLE stores ADD COLUMN IF NOT EXISTS nrs_store_id BIGINT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS nrs_elmer_id BIGINT;

-- Populate NRS IDs for existing stores
UPDATE stores SET nrs_store_id = 58968, nrs_elmer_id = 58511 WHERE name ILIKE '%bells%';
UPDATE stores SET nrs_store_id = 53039, nrs_elmer_id = 52592 WHERE name ILIKE '%kerens%';
UPDATE stores SET nrs_store_id = 61345, nrs_elmer_id = 60903 WHERE name ILIKE '%denison%';
UPDATE stores SET nrs_store_id = 63560, nrs_elmer_id = 63128 WHERE name ILIKE '%reno%';
UPDATE stores SET nrs_store_id = 78089, nrs_elmer_id = 77596 WHERE name ILIKE '%troup%';

-- Sync log table
CREATE TABLE IF NOT EXISTS nrs_sync_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid REFERENCES stores(id),
  sync_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  nrs_response jsonb,
  created_daily_sales_id uuid,
  error_message text,
  synced_by uuid,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nrs_sync_log_store_date ON nrs_sync_log(store_id, sync_date);
ALTER TABLE nrs_sync_log DISABLE ROW LEVEL SECURITY;
