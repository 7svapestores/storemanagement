-- ═══════════════════════════════════════════════════════════
-- StoreWise Database Schema for Supabase
-- Run this in Supabase SQL Editor (supabase.com > SQL Editor)
-- ═══════════════════════════════════════════════════════════

-- ── Enable extensions ───────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── ENUM types ──────────────────────────────────────────────
create type user_role as enum ('owner', 'manager', 'employee');

-- ── Profiles (extends Supabase auth.users) ──────────────────
create table profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  username text unique not null,
  name text not null,
  role user_role default 'employee',
  store_id uuid,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Stores ──────────────────────────────────────────────────
create table stores (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  color text default '#60A5FA',
  email text,
  address text,
  phone text,
  tax_rate numeric(6,4) default 0.0825,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Add foreign key to profiles after stores table exists
alter table profiles add constraint profiles_store_id_fkey
  foreign key (store_id) references stores(id);

-- ── Daily Sales ─────────────────────────────────────────────
create table daily_sales (
  id uuid default uuid_generate_v4() primary key,
  store_id uuid references stores(id) not null,
  date date not null,
  cash_sales numeric(12,2) default 0,
  card_sales numeric(12,2) default 0,
  total_sales numeric(12,2) default 0,
  credits numeric(12,2) default 0,
  tax_collected numeric(12,2) default 0,
  notes text,
  entered_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(store_id, date)
);

-- ── Cash Collections ────────────────────────────────────────
create table cash_collections (
  id uuid default uuid_generate_v4() primary key,
  store_id uuid references stores(id) not null,
  date date not null,
  cash_collected numeric(12,2) default 0,
  note text,
  collected_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(store_id, date)
);

-- ── Vendors ─────────────────────────────────────────────────
create table vendors (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  contact text,
  phone text,
  email text,
  category text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Purchases ───────────────────────────────────────────────
create table purchases (
  id uuid default uuid_generate_v4() primary key,
  store_id uuid references stores(id) not null,
  week_of date not null,
  item text not null,
  category text,
  quantity integer default 0,
  unit_cost numeric(12,2) default 0,
  total_cost numeric(12,2) default 0,
  supplier text,
  vendor_id uuid references vendors(id),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Expenses ────────────────────────────────────────────────
create table expenses (
  id uuid default uuid_generate_v4() primary key,
  store_id uuid references stores(id) not null,
  month text not null, -- '2024-01' format
  category text not null,
  amount numeric(12,2) default 0,
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Inventory ───────────────────────────────────────────────
create table inventory (
  id uuid default uuid_generate_v4() primary key,
  store_id uuid references stores(id) not null,
  name text not null,
  category text,
  cost_price numeric(12,2) default 0,
  sell_price numeric(12,2) default 0,
  stock integer default 0,
  reorder_level integer default 10,
  vendor_id uuid references vendors(id),
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Email Settings ──────────────────────────────────────────
create table email_settings (
  id uuid default uuid_generate_v4() primary key,
  enabled boolean default true,
  send_day text default 'monday',
  owner_email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Indexes ─────────────────────────────────────────────────
create index idx_daily_sales_store_date on daily_sales(store_id, date);
create index idx_daily_sales_date on daily_sales(date);
create index idx_cash_collections_store_date on cash_collections(store_id, date);
create index idx_purchases_store_week on purchases(store_id, week_of);
create index idx_purchases_week on purchases(week_of);
create index idx_expenses_store_month on expenses(store_id, month);
create index idx_inventory_store on inventory(store_id);
create index idx_inventory_store_cat on inventory(store_id, category);
create index idx_profiles_store on profiles(store_id);

-- ── Auto-update updated_at ──────────────────────────────────
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tr_profiles_updated before update on profiles for each row execute function update_updated_at();
create trigger tr_stores_updated before update on stores for each row execute function update_updated_at();
create trigger tr_daily_sales_updated before update on daily_sales for each row execute function update_updated_at();
create trigger tr_cash_collections_updated before update on cash_collections for each row execute function update_updated_at();
create trigger tr_purchases_updated before update on purchases for each row execute function update_updated_at();
create trigger tr_expenses_updated before update on expenses for each row execute function update_updated_at();
create trigger tr_inventory_updated before update on inventory for each row execute function update_updated_at();
create trigger tr_vendors_updated before update on vendors for each row execute function update_updated_at();

-- ── Auto-calculate total_sales and tax on insert/update ─────
create or replace function calc_sales_totals()
returns trigger as $$
begin
  new.total_sales = coalesce(new.cash_sales, 0) + coalesce(new.card_sales, 0);
  -- Get tax rate from store
  select tax_rate into new.tax_collected from stores where id = new.store_id;
  new.tax_collected = new.total_sales * coalesce(new.tax_collected, 0.0825);
  return new;
end;
$$ language plpgsql;

create trigger tr_calc_sales before insert or update on daily_sales for each row execute function calc_sales_totals();

-- Auto-calculate purchase total_cost
create or replace function calc_purchase_total()
returns trigger as $$
begin
  new.total_cost = coalesce(new.quantity, 0) * coalesce(new.unit_cost, 0);
  return new;
end;
$$ language plpgsql;

create trigger tr_calc_purchase before insert or update on purchases for each row execute function calc_purchase_total();

-- ═══════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- Owners see everything, employees see only their store
-- ═══════════════════════════════════════════════════════════

alter table profiles enable row level security;
alter table stores enable row level security;
alter table daily_sales enable row level security;
alter table cash_collections enable row level security;
alter table purchases enable row level security;
alter table expenses enable row level security;
alter table inventory enable row level security;
alter table vendors enable row level security;
alter table email_settings enable row level security;

-- Helper function: get current user's role
create or replace function get_user_role()
returns user_role as $$
  select role from profiles where id = auth.uid();
$$ language sql security definer stable;

-- Helper function: get current user's store
create or replace function get_user_store_id()
returns uuid as $$
  select store_id from profiles where id = auth.uid();
$$ language sql security definer stable;

-- Helper: is current user an owner?
create or replace function is_owner()
returns boolean as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'owner');
$$ language sql security definer stable;

-- ── Profiles policies ───────────────────────────────────────
create policy "Users can view own profile"
  on profiles for select using (id = auth.uid() or is_owner());
create policy "Owners can insert profiles"
  on profiles for insert with check (is_owner());
create policy "Owners can update profiles"
  on profiles for update using (is_owner());

-- ── Stores policies ─────────────────────────────────────────
create policy "Everyone can view stores"
  on stores for select using (true);
create policy "Owners can manage stores"
  on stores for all using (is_owner());

-- ── Daily Sales policies ────────────────────────────────────
-- Employees see only their store, owners see all
create policy "View sales"
  on daily_sales for select using (
    is_owner() or store_id = get_user_store_id()
  );
-- Employees can INSERT for their store only
create policy "Insert sales"
  on daily_sales for insert with check (
    is_owner() or store_id = get_user_store_id()
  );
-- Only owners can UPDATE and DELETE
create policy "Owners update sales"
  on daily_sales for update using (is_owner());
create policy "Owners delete sales"
  on daily_sales for delete using (is_owner());

-- ── Cash Collections policies (owner only) ──────────────────
create policy "Owner view cash"
  on cash_collections for select using (is_owner());
create policy "Owner manage cash"
  on cash_collections for all using (is_owner());

-- ── Purchases policies (owner only) ─────────────────────────
create policy "Owner view purchases"
  on purchases for select using (is_owner());
create policy "Owner manage purchases"
  on purchases for all using (is_owner());

-- ── Expenses policies (owner only) ──────────────────────────
create policy "Owner view expenses"
  on expenses for select using (is_owner());
create policy "Owner manage expenses"
  on expenses for all using (is_owner());

-- ── Inventory policies (owner only) ─────────────────────────
create policy "Owner view inventory"
  on inventory for select using (is_owner());
create policy "Owner manage inventory"
  on inventory for all using (is_owner());

-- ── Vendors policies (owner only) ───────────────────────────
create policy "Owner view vendors"
  on vendors for select using (is_owner());
create policy "Owner manage vendors"
  on vendors for all using (is_owner());

-- ── Email Settings (owner only) ─────────────────────────────
create policy "Owner view email settings"
  on email_settings for select using (is_owner());
create policy "Owner manage email settings"
  on email_settings for all using (is_owner());

-- ═══════════════════════════════════════════════════════════
-- VIEWS for dashboard/reports (computed data)
-- ═══════════════════════════════════════════════════════════

-- Cash reconciliation view
create or replace view cash_reconciliation as
select
  ds.store_id,
  ds.date,
  ds.cash_sales,
  coalesce(cc.cash_collected, 0) as cash_collected,
  coalesce(cc.cash_collected, 0) - ds.cash_sales as short_over,
  case
    when cc.cash_collected is null then 'pending'
    when abs(cc.cash_collected - ds.cash_sales) < 0.01 then 'matched'
    when cc.cash_collected > ds.cash_sales then 'over'
    else 'short'
  end as status,
  s.name as store_name,
  s.color as store_color
from daily_sales ds
left join cash_collections cc on ds.store_id = cc.store_id and ds.date = cc.date
join stores s on ds.store_id = s.id;

-- Weekly trends view
create or replace view weekly_trends as
select
  date_trunc('week', ds.date)::date as week,
  ds.store_id,
  sum(ds.total_sales) as total_sales,
  coalesce((
    select sum(p.total_cost)
    from purchases p
    where p.store_id = ds.store_id
    and date_trunc('week', p.week_of) = date_trunc('week', ds.date)
  ), 0) as total_purchases
from daily_sales ds
group by date_trunc('week', ds.date)::date, ds.store_id;
