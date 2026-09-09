-- ═══════════════════════════════════════════════════════════
-- Cached pricebook catalog: every item, every store.
--
-- The live NRS pricebook can only be read a page at a time, per store, so
-- grouping the whole catalog by UPC on demand would mean thousands of API
-- calls per page view. Instead a sync pages through NRS once and stores the
-- result here; browsing and grouping then run entirely off this table.
--
-- This is a CACHE, never the source of truth. Prices are always written
-- straight to NRS; rows here are refreshed from NRS afterwards.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pricebook_items (
  store_id   uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  upc        text NOT NULL,
  name       text,
  dept       text,
  size       text,
  cents      integer,
  cost_cents integer,
  -- Identifies the sync pass that wrote the row. Rows left behind by an
  -- earlier pass are items the store has since deleted, and are cleared when
  -- a pass finishes.
  run_id     text,
  synced_at  timestamptz DEFAULT now(),
  PRIMARY KEY (store_id, upc)
);

-- Grouping by UPC across stores is the whole point of the table.
CREATE INDEX IF NOT EXISTS idx_pricebook_items_upc ON pricebook_items(upc);
-- Prefix scans ("everything starting 810082") for the family view.
CREATE INDEX IF NOT EXISTS idx_pricebook_items_upc_pattern
  ON pricebook_items(upc text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_pricebook_items_store_run
  ON pricebook_items(store_id, run_id);

ALTER TABLE pricebook_items DISABLE ROW LEVEL SECURITY;

-- ── Prefix rollup ──────────────────────────────────────────
-- The catalog view divides products by the leading digits of the UPC, so the
-- grouping is done in the database rather than by pulling every row into the
-- app. `mode()` picks the item name the most rows agree on, which is only a
-- label — the grouping itself never looks at names.
CREATE OR REPLACE FUNCTION pricebook_upc_prefixes(p_len int DEFAULT 6)
RETURNS TABLE (
  prefix      text,
  upc_count   bigint,
  store_count bigint,
  sample_name text,
  min_cents   integer,
  max_cents   integer
)
LANGUAGE sql STABLE AS $$
  SELECT
    left(upc, p_len)                              AS prefix,
    count(DISTINCT upc)                           AS upc_count,
    count(DISTINCT store_id)                      AS store_count,
    mode() WITHIN GROUP (ORDER BY name)           AS sample_name,
    min(cents)                                    AS min_cents,
    max(cents)                                    AS max_cents
  FROM pricebook_items
  WHERE upc IS NOT NULL AND length(upc) >= p_len
  GROUP BY left(upc, p_len)
  ORDER BY count(DISTINCT upc) DESC, left(upc, p_len);
$$;
