-- Track who added each item on an inventory count.
alter table inventory_count_items
  add column if not exists created_by uuid references profiles(id);
