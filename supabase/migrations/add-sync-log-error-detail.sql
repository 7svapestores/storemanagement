-- 7S Agent Logs: structured failure detail.
--
-- Failed sync rows previously carried only `error_message` (often just
-- "NRS API 500:" with an empty body) and a null `nrs_response`, so the
-- "Details" expander on the Agent Logs page had nothing to render. This
-- column holds the per-attempt breakdown from lib/nrs-fetch.js — status,
-- endpoint, attempt count, response body and a plain-English hint.

ALTER TABLE nrs_sync_log ADD COLUMN IF NOT EXISTS error_detail jsonb;

-- Failed rows are what the owner filters on; make that scan cheap.
CREATE INDEX IF NOT EXISTS idx_nrs_sync_log_status_date
  ON nrs_sync_log(status, sync_date DESC);
