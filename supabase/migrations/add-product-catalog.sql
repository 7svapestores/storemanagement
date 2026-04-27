-- ═══════════════════════════════════════════════════════════
-- Product Catalog: brands and flavors that build up over time
-- as employees enter inventory. Categories live in the existing
-- inventory_departments table.
--
-- Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════

-- ── Brands (scoped to a category / department) ─────────────
CREATE TABLE IF NOT EXISTS product_brands (
  id            uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  department_id uuid NOT NULL REFERENCES inventory_departments(id) ON DELETE CASCADE,
  name          text NOT NULL,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_brands_dept_name
  ON product_brands(department_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_product_brands_dept
  ON product_brands(department_id, name);

-- ── Flavors (scoped to a brand) ────────────────────────────
CREATE TABLE IF NOT EXISTS product_flavors (
  id         uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  brand_id   uuid NOT NULL REFERENCES product_brands(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_flavors_brand_name
  ON product_flavors(brand_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_product_flavors_brand
  ON product_flavors(brand_id, name);

-- ── Seed any missing categories employees might add to ─────
-- Existing seeds (Vapes, Pre Rolls, Hydroxy, E-Liquids, Devices,
-- Gummies, Kratom, Novelty, THCA) are left alone.
INSERT INTO inventory_departments (name, sort_order)
SELECT v.name, v.sort_order
FROM (VALUES
  ('Drinks', 100),
  ('Coils',  110)
) AS v(name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_departments d
  WHERE lower(d.name) = lower(v.name)
);
