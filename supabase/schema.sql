-- =====================================================================
-- SVB (Saaki Vriksh Beverages) — Full schema (combined)
-- Paste this entire file into the Supabase SQL Editor and run it once
-- on a fresh project (or again on an existing one to pick up fixes —
-- every object here uses `if not exists`, `or replace`, or a preceding
-- `drop ... if exists` guard, and known-bad legacy policies are
-- explicitly dropped before being recreated correctly).
-- It is the concatenation of, in order:
--   supabase/migrations/001_initial_schema.sql
--   supabase/migrations/001_location_schema.sql
--   supabase/migrations/002_stock_sync_and_realtime.sql
--   supabase/migrations/003_reporting_and_entries_views.sql
--   supabase/migrations/004_admin_signup_no_approval.sql
--   supabase/migrations/005_invoice_series_and_pending_bills.sql
--   supabase/migrations/006_unified_stock_from_bills.sql
--   supabase/migrations/007_live_locations_admin_write.sql
--   supabase/migrations/008_bills_customer_name.sql
--   supabase/migrations/009_shared_row_update_delete.sql
-- =====================================================================

-- ============================== 001_initial_schema.sql ==============================

-- =====================================================================
-- SVB (Saaki Vriksh Beverages) — Initial schema
-- File: supabase/migrations/001_initial_schema.sql
-- Target project: svb (ap-south-1)
-- Run via: supabase db push  OR  paste into the Supabase SQL editor.
-- =====================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------------
-- updated_at trigger helper
-- ------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------------
-- PROFILES  (1:1 with auth.users)
-- ------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'user',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_profiles_updated
before update on public.profiles
for each row execute function public.touch_updated_at();

-- Auto-create a profile row whenever a user signs up via Supabase Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'user')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Admin check helper (used in RLS policies).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- ------------------------------------------------------------------
-- CUSTOMERS
-- ------------------------------------------------------------------
create table if not exists public.customers (
  id                         uuid primary key default uuid_generate_v4(),
  user_id                    uuid references auth.users(id) on delete cascade,
  customer_name              text not null,
  display_name               text,
  has_gst                    boolean not null default false,
  place_of_supply            text,
  place_of_supply_state_code text,
  gst_treatment              text,
  gstin                      text,
  billing_attention          text,
  billing_address            text,
  billing_street2            text,
  billing_city               text,
  billing_state              text,
  billing_country            text default 'India',
  billing_code               text,
  shipping_attention         text,
  shipping_address           text,
  shipping_street2           text,
  shipping_city              text,
  shipping_state             text,
  shipping_country           text default 'India',
  shipping_code              text,
  goli_fizz_mrp              numeric not null default 0,
  goli_blast_mrp             numeric not null default 0,
  petbottle_mrp               numeric not null default 0,
  payment_terms_label        text default 'Due on Receipt',
  closing_stock_crates       integer not null default 0,
  closing_stock_loose        integer not null default 0,
  product_prices             jsonb not null default '{}',
  notes                      text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create trigger trg_customers_updated
before update on public.customers
for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------
-- PRODUCTS
-- ------------------------------------------------------------------
create table if not exists public.products (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users(id) on delete cascade,
  category    text not null check (category in ('Goli Fizz','Goli Blast','Petbottle')),
  flavour     text not null,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_products_updated
before update on public.products
for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------
-- INVOICE SERIES
-- ------------------------------------------------------------------
create table if not exists public.invoice_series (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid references auth.users(id) on delete cascade,
  type         text not null check (type in ('gst','non_gst')),
  prefix       text not null,
  series_name  text not null,
  next_number  integer not null default 1,
  padding      integer not null default 4,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger trg_invoice_series_updated
before update on public.invoice_series
for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------
-- BILLS
-- ------------------------------------------------------------------
create table if not exists public.bills (
  id                         uuid primary key default uuid_generate_v4(),
  user_id                    uuid references auth.users(id) on delete cascade,
  customer_id                uuid references public.customers(id) on delete cascade,
  has_gst                    boolean not null default false,
  invoice_number             text not null,
  invoice_series             text,
  invoice_date               date not null,
  due_date                   date,
  place_of_supply            text,
  place_of_supply_state_code text,
  gst_treatment              text,
  gstin                      text,
  billing_attention          text,
  billing_address            text,
  billing_street2            text,
  billing_city               text,
  billing_state              text,
  billing_country            text,
  billing_code               text,
  shipping_attention         text,
  shipping_address           text,
  shipping_street2           text,
  shipping_city              text,
  shipping_state             text,
  shipping_country           text,
  shipping_code              text,
  payment_terms_label        text,
  items                      jsonb not null default '[]',
  subtotal                   numeric not null default 0,
  tax_total                  numeric not null default 0,
  total                      numeric not null default 0,
  returned_crates            integer not null default 0,
  damaged_bottles            integer not null default 0,
  payment_status             text not null default 'pending' check (payment_status in ('completed','pending')),
  payment_mode               text,
  paid_amount                numeric not null default 0,
  dispatch_status            text not null default 'pending' check (dispatch_status in ('pending','dispatched')),
  dispatch_date              date,
  delivery_status            text not null default 'pending' check (delivery_status in ('pending','delivered')),
  delivery_date              date,
  terms_conditions           text,
  created_by_name            text,
  modified_by_name           text,
  delivery_id                uuid,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create trigger trg_bills_updated
before update on public.bills
for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------
-- DELIVERIES
-- ------------------------------------------------------------------
create table if not exists public.deliveries (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid references auth.users(id) on delete cascade,
  customer_id      uuid references public.customers(id) on delete cascade,
  bill_id          uuid references public.bills(id) on delete set null,
  customer_name    text,
  delivery_date    date not null,
  payment_status   text not null default 'pending' check (payment_status in ('completed','pending')),
  payment_mode     text check (payment_mode in ('UPI','Cash','Bank Transfer','Cheque') or payment_mode is null),
  paid_amount      numeric not null default 0,
  items            jsonb not null default '[]',
  returned_crates  integer not null default 0,
  damaged_bottles  integer not null default 0,
  total_bottles    integer not null default 0,
  total_amount     numeric not null default 0,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger trg_deliveries_updated
before update on public.deliveries
for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------
-- CRATE ENTRIES
-- ------------------------------------------------------------------
create table if not exists public.crate_entries (
  id                     uuid primary key default uuid_generate_v4(),
  user_id                uuid references auth.users(id) on delete cascade,
  customer_id            uuid references public.customers(id) on delete cascade,
  customer_name          text,
  entry_date             date not null,
  crates_returned        integer not null default 0,
  loose_bottles_returned integer not null default 0,
  damaged_bottles        integer not null default 0,
  bill_id                uuid references public.bills(id) on delete set null,
  source                 text default 'manual',
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger trg_crate_entries_updated
before update on public.crate_entries
for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------
-- DAILY PRODUCTION
-- ------------------------------------------------------------------
create table if not exists public.daily_productions (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references auth.users(id) on delete cascade,
  production_date date not null,
  entries         jsonb not null default '[]',
  closing_stock   jsonb not null default '[]',
  total_units     integer not null default 0,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_daily_productions_updated
before update on public.daily_productions
for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------------
create index if not exists idx_customers_user_id        on public.customers(user_id);
create index if not exists idx_bills_customer_id        on public.bills(customer_id);
create index if not exists idx_bills_invoice_date       on public.bills(invoice_date);
create index if not exists idx_bills_user_id            on public.bills(user_id);
create index if not exists idx_deliveries_customer_id  on public.deliveries(customer_id);
create index if not exists idx_deliveries_delivery_date on public.deliveries(delivery_date);
create index if not exists idx_crate_entries_customer_id on public.crate_entries(customer_id);
create index if not exists idx_crate_entries_entry_date on public.crate_entries(entry_date);
create index if not exists idx_daily_productions_date  on public.daily_productions(production_date);

-- ------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Each table: owner (user_id = auth.uid()) OR admin can do everything.
-- ------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.customers        enable row level security;
alter table public.products        enable row level security;
alter table public.invoice_series  enable row level security;
alter table public.bills            enable row level security;
alter table public.deliveries       enable row level security;
alter table public.crate_entries    enable row level security;
alter table public.daily_productions enable row level security;

-- PROFILES: a user can read/update only their own profile; admins read all.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select
  using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles_insert" on public.profiles;
create policy "profiles_insert" on public.profiles for insert
  with check (id = auth.uid() or public.is_admin());
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles for update
  using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles_delete" on public.profiles;
create policy "profiles_delete" on public.profiles for delete
  using (id = auth.uid() or public.is_admin());

-- Generic owner-or-admin policy macro applied to each business table.
drop policy if exists "customers_select" on public.customers;
create policy "customers_select" on public.customers for select
  using (user_id = auth.uid() or public.is_admin() or user_id is null);
drop policy if exists "customers_insert" on public.customers;
create policy "customers_insert" on public.customers for insert
  with check (user_id = auth.uid() or public.is_admin());
drop policy if exists "customers_update" on public.customers;
create policy "customers_update" on public.customers for update
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "customers_delete" on public.customers;
create policy "customers_delete" on public.customers for delete
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "products_select" on public.products;
create policy "products_select" on public.products for select
  using (user_id = auth.uid() or public.is_admin() or user_id is null);
drop policy if exists "products_insert" on public.products;
create policy "products_insert" on public.products for insert
  with check (user_id = auth.uid() or public.is_admin());
drop policy if exists "products_update" on public.products;
create policy "products_update" on public.products for update
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "products_delete" on public.products;
create policy "products_delete" on public.products for delete
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "invoice_series_select" on public.invoice_series;
create policy "invoice_series_select" on public.invoice_series for select
  using (user_id = auth.uid() or public.is_admin() or user_id is null);
drop policy if exists "invoice_series_insert" on public.invoice_series;
create policy "invoice_series_insert" on public.invoice_series for insert
  with check (user_id = auth.uid() or public.is_admin());
drop policy if exists "invoice_series_update" on public.invoice_series;
create policy "invoice_series_update" on public.invoice_series for update
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "invoice_series_delete" on public.invoice_series;
create policy "invoice_series_delete" on public.invoice_series for delete
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "bills_select" on public.bills;
create policy "bills_select" on public.bills for select
  using (user_id = auth.uid() or public.is_admin() or user_id is null);
drop policy if exists "bills_insert" on public.bills;
create policy "bills_insert" on public.bills for insert
  with check (user_id = auth.uid() or public.is_admin());
drop policy if exists "bills_update" on public.bills;
create policy "bills_update" on public.bills for update
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "bills_delete" on public.bills;
create policy "bills_delete" on public.bills for delete
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "deliveries_select" on public.deliveries;
create policy "deliveries_select" on public.deliveries for select
  using (user_id = auth.uid() or public.is_admin() or user_id is null);
drop policy if exists "deliveries_insert" on public.deliveries;
create policy "deliveries_insert" on public.deliveries for insert
  with check (user_id = auth.uid() or public.is_admin());
drop policy if exists "deliveries_update" on public.deliveries;
create policy "deliveries_update" on public.deliveries for update
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "deliveries_delete" on public.deliveries;
create policy "deliveries_delete" on public.deliveries for delete
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "crate_entries_select" on public.crate_entries;
create policy "crate_entries_select" on public.crate_entries for select
  using (user_id = auth.uid() or public.is_admin() or user_id is null);
drop policy if exists "crate_entries_insert" on public.crate_entries;
create policy "crate_entries_insert" on public.crate_entries for insert
  with check (user_id = auth.uid() or public.is_admin());
drop policy if exists "crate_entries_update" on public.crate_entries;
create policy "crate_entries_update" on public.crate_entries for update
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "crate_entries_delete" on public.crate_entries;
create policy "crate_entries_delete" on public.crate_entries for delete
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "daily_productions_select" on public.daily_productions;
create policy "daily_productions_select" on public.daily_productions for select
  using (user_id = auth.uid() or public.is_admin() or user_id is null);
drop policy if exists "daily_productions_insert" on public.daily_productions;
create policy "daily_productions_insert" on public.daily_productions for insert
  with check (user_id = auth.uid() or public.is_admin());
drop policy if exists "daily_productions_update" on public.daily_productions;
create policy "daily_productions_update" on public.daily_productions for update
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "daily_productions_delete" on public.daily_productions;
create policy "daily_productions_delete" on public.daily_productions for delete
  using (user_id = auth.uid() or public.is_admin());

-- ------------------------------------------------------------------
-- ORDERS (internal invoices — created from the Incoming Orders tab)
-- ------------------------------------------------------------------
create table if not exists public.orders (
  id                      uuid primary key default uuid_generate_v4(),
  user_id                 uuid references auth.users(id) on delete cascade,
  customer_id             uuid references public.customers(id) on delete cascade,
  customer_name           text,
  display_name            text,
  has_gst                 boolean not null default false,
  internal_invoice_number text not null,
  invoice_number          text,
  invoice_series          text,
  order_date              date not null,
  items                   jsonb not null default '[]',
  total_bottles           integer not null default 0,
  total_amount            numeric not null default 0,
  dispatch_status         text not null default 'pending' check (dispatch_status in ('pending','dispatched')),
  dispatched_date         date,
  bill_id                 uuid,
  created_by_name         text,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger trg_orders_updated
before update on public.orders
for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------
-- DAILY SUMMARIES (per-user route timings & kilometres)
-- ------------------------------------------------------------------
create table if not exists public.daily_summaries (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid references auth.users(id) on delete cascade,
  user_name           text,
  summary_date        date not null,
  morning_start_time  text,
  evening_end_time    text,
  morning_kms         numeric not null default 0,
  evening_kms         numeric not null default 0,
  total_kms           numeric not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger trg_daily_summaries_updated
before update on public.daily_summaries
for each row execute function public.touch_updated_at();

create index if not exists idx_orders_customer_id      on public.orders(customer_id);
create index if not exists idx_orders_order_date       on public.orders(order_date);
create index if not exists idx_daily_summaries_user_id on public.daily_summaries(user_id);
create index if not exists idx_daily_summaries_date    on public.daily_summaries(summary_date);
create index if not exists idx_bills_created_by        on public.bills(created_by_name);

alter table public.orders          enable row level security;
alter table public.daily_summaries enable row level security;

drop policy if exists "orders_select" on public.orders;
create policy "orders_select" on public.orders for select
  using (user_id = auth.uid() or public.is_admin() or user_id is null);
drop policy if exists "orders_insert" on public.orders;
create policy "orders_insert" on public.orders for insert
  with check (user_id = auth.uid() or public.is_admin());
drop policy if exists "orders_update" on public.orders;
create policy "orders_update" on public.orders for update
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "orders_delete" on public.orders;
create policy "orders_delete" on public.orders for delete
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "daily_summaries_select" on public.daily_summaries;
create policy "daily_summaries_select" on public.daily_summaries for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "daily_summaries_insert" on public.daily_summaries;
create policy "daily_summaries_insert" on public.daily_summaries for insert
  with check (user_id = auth.uid() or public.is_admin());
drop policy if exists "daily_summaries_update" on public.daily_summaries;
create policy "daily_summaries_update" on public.daily_summaries for update
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "daily_summaries_delete" on public.daily_summaries;
create policy "daily_summaries_delete" on public.daily_summaries for delete
  using (user_id = auth.uid() or public.is_admin());

-- ------------------------------------------------------------------
-- STORAGE BUCKET (private) for invoice PDFs / attachments
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

drop policy if exists "invoice_files_read" on storage.objects;
create policy "invoice_files_read" on storage.objects
  for select using (bucket_id = 'invoices' and (owner = auth.uid() or public.is_admin()));
drop policy if exists "invoice_files_upload" on storage.objects;
create policy "invoice_files_upload" on storage.objects
  for insert with check (bucket_id = 'invoices' and (owner = auth.uid() or public.is_admin()));
drop policy if exists "invoice_files_update" on storage.objects;
create policy "invoice_files_update" on storage.objects
  for update using (bucket_id = 'invoices' and (owner = auth.uid() or public.is_admin()));
drop policy if exists "invoice_files_delete" on storage.objects;
create policy "invoice_files_delete" on storage.objects
  for delete using (bucket_id = 'invoices' and (owner = auth.uid() or public.is_admin()));

-- ===================================================================
-- End of migration
-- ===================================================================


-- ============================== 001_location_schema.sql ==============================

-- =====================================================================
-- SVB Location Tracking Schema  (supabase/migrations/001_location_schema.sql)
-- Run on your Supabase project. Enables periodic breadcrumbs + live tracking.
--
-- Depends on 001_initial_schema.sql, which already creates public.profiles
-- (with the `role` column) and the non-recursive public.is_admin() helper —
-- this file does NOT redefine either. (An earlier version of this file
-- duplicated public.profiles and added a policy that subqueried
-- public.profiles from within a policy ON public.profiles itself, which
-- Postgres rejects with "infinite recursion detected in policy for
-- relation profiles" (42P17). That duplication has been removed — admin
-- checks here go through the same is_admin() function everywhere.)
-- =====================================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------------
-- Cleanup: remove the old recursive policies from earlier versions of
-- this file, if they were already applied to this project. These queried
-- public.profiles directly from within a policy ON public.profiles,
-- which Postgres rejects at query time with "infinite recursion detected
-- in policy for relation profiles" (42P17) — breaking every profile read,
-- and therefore every db.auth.me() call in the app.
-- ------------------------------------------------------------------
drop policy if exists "profiles self read" on public.profiles;
drop policy if exists "profiles admin read" on public.profiles;

-- ------------------------------------------------------------------
-- live_locations: current position for active tracking (one row per user)
-- ------------------------------------------------------------------
create table if not exists public.live_locations (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  latitude       float8 not null default 0,
  longitude      float8 not null default 0,
  speed          float8 not null default 0,
  heading        float8 not null default 0,
  is_live_active boolean not null default false,
  updated_at     timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- location_history: periodic breadcrumb trail (15-min nodes)
-- ------------------------------------------------------------------
create table if not exists public.location_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  latitude    float8 not null,
  longitude   float8 not null,
  accuracy    float8 not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_location_history_user_created
  on public.location_history (user_id, created_at desc);

-- ------------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------------
alter table public.live_locations   enable row level security;
alter table public.location_history enable row level security;

-- live_locations: users write only their own row; admins read all
-- (admin write policy is added separately in
-- 005_live_locations_admin_write.sql, so admins can also toggle another
-- user's is_live_active).
drop policy if exists "live self write" on public.live_locations;
create policy "live self write" on public.live_locations for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "live admin read" on public.live_locations;
create policy "live admin read" on public.live_locations for select
  using (public.is_admin());

-- location_history: users insert only their own; admins read all
drop policy if exists "history self insert" on public.location_history;
create policy "history self insert" on public.location_history for insert
  with check (auth.uid() = user_id);

drop policy if exists "history admin read" on public.location_history;
create policy "history admin read" on public.location_history for select
  using (public.is_admin());

-- ------------------------------------------------------------------
-- Realtime
-- ------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_locations'
  ) then
    execute 'alter publication supabase_realtime add table public.live_locations';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'location_history'
  ) then
    execute 'alter publication supabase_realtime add table public.location_history';
  end if;
end $$;

-- ------------------------------------------------------------------
-- updated_at trigger for live_locations
-- (touch_updated_at() is already defined by 001_initial_schema.sql)
-- ------------------------------------------------------------------
drop trigger if exists trg_live_locations_updated on public.live_locations;
create trigger trg_live_locations_updated
before update on public.live_locations
for each row execute function public.touch_updated_at();

-- ===================================================================
-- End of migration
-- ===================================================================


-- ============================== 002_stock_sync_and_realtime.sql ==============================

-- =====================================================================
-- SVB — Stock sync & realtime migration
-- File: supabase/migrations/002_stock_sync_and_realtime.sql
-- Additive to 001_initial_schema.sql + 001_location_schema.sql.
-- Reflects the unified crate/closing-stock ledger and live location features.
-- =====================================================================

-- Index the bill -> crate entry link used by the auto-sync from Bill Entries.
create index if not exists idx_crate_entries_bill_id on public.crate_entries(bill_id);
create index if not exists idx_deliveries_bill_id on public.deliveries(bill_id);

-- ------------------------------------------------------------------
-- hotel_closing_stock view
--   Opening (manual customer closing stock) + delivered bottles
--   - returned crates*24 - loose returned - damaged, per customer.
--   Keeps Customers, Crates Entries and Bill Entries reading the same number.
-- ------------------------------------------------------------------
create or replace view public.hotel_closing_stock as
with delivered as (
  select customer_id, coalesce(sum(total_bottles), 0) as bottles
  from public.deliveries
  group by customer_id
),
returns as (
  select customer_id,
    coalesce(sum(crates_returned), 0) * 24
    + coalesce(sum(loose_bottles_returned), 0)
    + coalesce(sum(damaged_bottles), 0) as returned_bottles
  from public.crate_entries
  group by customer_id
)
select
  c.id as customer_id,
  c.customer_name,
  c.display_name,
  (coalesce(c.closing_stock_crates, 0) * 24 + coalesce(c.closing_stock_loose, 0)
    + coalesce(d.bottles, 0)
    - coalesce(r.returned_bottles, 0)) as closing_bottles,
  floor((coalesce(c.closing_stock_crates, 0) * 24 + coalesce(c.closing_stock_loose, 0)
    + coalesce(d.bottles, 0) - coalesce(r.returned_bottles, 0)) / 24) as closing_crates,
  mod((coalesce(c.closing_stock_crates, 0) * 24 + coalesce(c.closing_stock_loose, 0)
    + coalesce(d.bottles, 0) - coalesce(r.returned_bottles, 0)), 24) as closing_loose
from public.customers c
left join delivered d on d.customer_id = c.id
left join returns   r on r.customer_id = c.id;

comment on view public.hotel_closing_stock is
  'Live closing-stock ledger per hotel: opening + delivered - returned (24 bottles/crate).';

grant select on public.hotel_closing_stock to authenticated;

-- ------------------------------------------------------------------
-- Realtime: enable live updates for the operational tables.
--   live_locations / location_history are already in 001_location_schema.sql.
-- ------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bills'
  ) then
    execute 'alter publication supabase_realtime add table public.bills';
  end if;
end $$;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deliveries'
  ) then
    execute 'alter publication supabase_realtime add table public.deliveries';
  end if;
end $$;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crate_entries'
  ) then
    execute 'alter publication supabase_realtime add table public.crate_entries';
  end if;
end $$;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    execute 'alter publication supabase_realtime add table public.orders';
  end if;
end $$;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daily_summaries'
  ) then
    execute 'alter publication supabase_realtime add table public.daily_summaries';
  end if;
end $$;

-- ===================================================================
-- End of migration
-- ===================================================================


-- ============================== 003_reporting_and_entries_views.sql ==============================

-- =====================================================================
-- SVB — Reporting & entries export migration
-- File: supabase/migrations/003_reporting_and_entries_views.sql
-- Additive to 001_initial_schema.sql, 001_location_schema.sql and
-- 002_stock_sync_and_realtime.sql. Reflects:
--   * Crates Entries: date-range entries export + the day's entries
--     included on the closing-stock PDF.
--   * Orders: checkbox summary showing Crates and Loose bottles per
--     flavour (per hotel, per category).
-- =====================================================================

-- ------------------------------------------------------------------
-- Idempotent repair: align columns introduced after the initial
-- provisioning (projects set up from an older DDL may lack them).
-- ------------------------------------------------------------------
alter table public.crate_entries add column if not exists bill_id text;
alter table public.crate_entries add column if not exists source text default 'manual';
alter table public.crate_entries add column if not exists notes text;
alter table public.orders add column if not exists display_name text;
alter table public.orders add column if not exists dispatched_date date;
alter table public.orders add column if not exists notes text;
alter table public.deliveries add column if not exists bill_id text;
alter table public.bills add column if not exists modified_by_name text;
alter table public.bills add column if not exists delivery_id text;

-- Fast date-range scans for the entries export (From/To) and the
-- "entries made today" section of the closing-stock PDF.
create index if not exists idx_crate_entries_entry_date
  on public.crate_entries(entry_date);

-- ------------------------------------------------------------------
-- v_crate_entries_report — one row per crate entry (manual + bill),
--   newest first. Backs the Crates Entries date-range PDF export.
-- ------------------------------------------------------------------
create or replace view public.v_crate_entries_report as
select
  ce.id,
  ce.entry_date,
  ce.customer_id,
  ce.customer_name,
  ce.crates_returned,
  ce.loose_bottles_returned,
  ce.damaged_bottles,
  ce.source,
  ce.bill_id,
  ce.notes
from public.crate_entries ce
order by ce.entry_date desc, ce.created_at desc;

comment on view public.v_crate_entries_report is
  'All crate returns (manual + from bills), newest first — used by the Crates Entries date-range PDF export and the day''s-entries section of the closing-stock PDF.';

grant select on public.v_crate_entries_report to authenticated;

-- ------------------------------------------------------------------
-- v_order_flavour_summary — crates & loose bottles per order item,
--   mirroring the Orders checkbox summary (crates + loose per flavour,
--   per hotel, per category).
-- ------------------------------------------------------------------
create or replace view public.v_order_flavour_summary as
select
  o.id as order_id,
  o.order_date,
  o.has_gst,
  coalesce(nullif(o.display_name, ''), o.customer_name) as hotel,
  it->>'category' as category,
  it->>'flavour'  as flavour,
  coalesce((it->>'crates')::numeric, 0) as crates,
  coalesce((it->>'loose')::numeric, 0)  as loose
from public.orders o,
  jsonb_array_elements(o.items) as it;

comment on view public.v_order_flavour_summary is
  'Crates & loose bottles per order item — mirrors the Orders summary (crates + loose per flavour per hotel).';

grant select on public.v_order_flavour_summary to authenticated;

-- ===================================================================
-- End of migration
-- ===================================================================


-- ============================== 004_admin_signup_no_approval.sql ==============================

-- =====================================================================
-- SVB — Self-service account roles (admin at signup, no approval)
-- File: supabase/migrations/004_admin_signup_no_approval.sql
-- Additive to 001–003. Reflects the app changes:
--   * Create Account: selecting "Admin" applies the role immediately —
--     no approval by an existing admin, no password restrictions.
--   * Thermal print bills (GST + non-GST): quantity is displayed as
--     Crates + Loose bottles — items already store {crates, loose} in
--     bills.items / orders.items jsonb, so no schema change is needed.
-- =====================================================================

-- ------------------------------------------------------------------
-- 1. handle_new_user — honour the account type chosen at signup
--    (raw_user_meta_data->>'role'), validated, applied immediately.
-- ------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case
      when lower(coalesce(new.raw_user_meta_data->>'role', '')) = 'admin' then 'admin'
      else 'user'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------
-- 2. set_my_role(role) — lets any signed-in user set their own role
--    ('admin' or 'user'). SVB policy: no approval by an existing admin.
-- ------------------------------------------------------------------
create or replace function public.set_my_role(p_role text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
begin
  if lower(coalesce(p_role, '')) = 'admin' then
    v_role := 'admin';
  else
    v_role := 'user';
  end if;

  update public.profiles
  set role = v_role
  where id = auth.uid();

  return v_role;
end;
$$;

grant execute on function public.set_my_role(text) to authenticated;

-- ===================================================================
-- End of migration
-- ===================================================================


-- ============================== 005_invoice_series_and_pending_bills.sql ==============================

-- =====================================================================
-- SVB — Invoice series & pending-bills reporting
-- File: supabase/migrations/005_invoice_series_and_pending_bills.sql
-- Additive to 001–004. Reflects the app changes:
--   * Settings → Invoice Series: prefix + current bill number editable
--     and saved; bill generation queries the active series, appends the
--     next sequence number and auto-increments the stored counter.
--   * Default fallback series (GST: INV-1001, Non-GST: NG-1001) created
--     automatically if no active series exists.
--   * Bill Entries: pending-bills warning banner per customer, backed by
--     the v_customer_pending_bills view.
-- =====================================================================

-- One active series per bill type.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_series_type_key') THEN
    ALTER TABLE public.invoice_series ADD CONSTRAINT invoice_series_type_key UNIQUE (type);
  END IF;
END;
$$;

-- Default fallback series (no-op if rows already exist).
INSERT INTO public.invoice_series (id, type, prefix, series_name, next_number, padding)
VALUES (gen_random_uuid(), 'gst', 'INV-', 'GST Series', 1001, 4)
ON CONFLICT (type) DO NOTHING;

INSERT INTO public.invoice_series (id, type, prefix, series_name, next_number, padding)
VALUES (gen_random_uuid(), 'non_gst', 'NG-', 'Non-GST Series', 1001, 4)
ON CONFLICT (type) DO NOTHING;

-- next_invoice_number(type): returns the next invoice number and atomically
-- increments the stored counter. Mirrors the app's invoiceSeries utility.
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_next numeric;
  v_padding numeric;
BEGIN
  INSERT INTO public.invoice_series (id, type, prefix, series_name, next_number, padding)
  VALUES (gen_random_uuid(),
    p_type,
    CASE WHEN p_type = 'gst' THEN 'INV-' ELSE 'NG-' END,
    CASE WHEN p_type = 'gst' THEN 'GST Series' ELSE 'Non-GST Series' END,
    1001, 4)
  ON CONFLICT (type) DO NOTHING;

  UPDATE public.invoice_series
  SET next_number = next_number + 1
  WHERE type = p_type
  RETURNING prefix, next_number - 1, padding INTO v_prefix, v_next, v_padding;

  RETURN v_prefix || lpad(v_next::text, v_padding::int, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_invoice_number(text) TO authenticated;

-- Pending (unpaid) bills per customer — backs the Bill Entries warning banner:
--   select * from v_customer_pending_bills where customer_id = '<id>';
CREATE OR REPLACE VIEW public.v_customer_pending_bills AS
SELECT customer_id,
  count(*) AS pending_count,
  sum(greatest(total - coalesce(paid_amount, 0), 0)) AS unpaid_balance
FROM public.bills
WHERE coalesce(payment_status, 'pending') = 'pending'
GROUP BY customer_id;

-- ===================================================================
-- End of migration
-- ===================================================================


-- ============================== 006_unified_stock_from_bills.sql ==============================

-- =====================================================================
-- SVB — Unified stock ledger (bills as source of truth)
-- File: supabase/migrations/006_unified_stock_from_bills.sql
-- Additive to 001–005.
--
-- BREAKING CHANGE to hotel_closing_stock view:
--   Delivered bottles are now computed from bills.items (JSONB) instead
--   of deliveries.total_bottles.  This makes the closing stock identical
--   across Customers, Crates Entries, Bill Entries and the thermal print,
--   because the Bill entity is the single source of truth for what was
--   delivered (items array) and the CrateEntry is the single source of
--   truth for what was returned (synced from bills + manual entries).
--
--   Previous Closing Stock (thermal) = stock excluding this bill.
--   Closing Stock (Hotel) (thermal)   = stock including this bill.
--   Both are derived from the same ledger, so the number printed on the
--   bill matches what every tab shows.
-- =====================================================================

-- ------------------------------------------------------------------
-- hotel_closing_stock (replaced)
--   Opening (manual customer closing stock)
--   + delivered bottles (summed from every bill's items JSONB,
--     24 bottles/crate for Goli Fizz/Blast, 30 for Petbottle)
--   - returned bottles (crates_returned*24 + loose_returned + damaged,
--     from crate_entries — both manual and bill-synced)
--   Per customer.
-- ------------------------------------------------------------------
-- CREATE OR REPLACE VIEW cannot change an existing view's column types
-- (Postgres error 42P16: "cannot change data type of view column").
-- A prior run of this migration (or of 002_stock_sync_and_realtime.sql,
-- which originally defined hotel_closing_stock) may have left
-- closing_bottles as bigint; this version computes it as numeric. Drop
-- first so the CREATE below always succeeds, on a fresh project or a
-- re-run alike.
DROP VIEW IF EXISTS public.hotel_closing_stock;

CREATE OR REPLACE VIEW public.hotel_closing_stock AS
WITH delivered AS (
  SELECT b.customer_id,
    COALESCE(SUM(
      COALESCE((it->>'crates')::numeric, 0) *
        CASE WHEN it->>'category' = 'Petbottle' THEN 30 ELSE 24 END
      + COALESCE((it->>'loose')::numeric, 0)
    ), 0) AS bottles
  FROM public.bills b,
    jsonb_array_elements(COALESCE(b.items, '[]'::jsonb)) AS it
  GROUP BY b.customer_id
),
returns AS (
  SELECT customer_id,
    COALESCE(SUM(crates_returned), 0) * 24
    + COALESCE(SUM(loose_bottles_returned), 0)
    + COALESCE(SUM(damaged_bottles), 0) AS returned_bottles
  FROM public.crate_entries
  GROUP BY customer_id
)
SELECT
  c.id AS customer_id,
  c.customer_name,
  c.display_name,
  (COALESCE(c.closing_stock_crates, 0) * 24 + COALESCE(c.closing_stock_loose, 0)
    + COALESCE(d.bottles, 0)
    - COALESCE(r.returned_bottles, 0)) AS closing_bottles,
  FLOOR((COALESCE(c.closing_stock_crates, 0) * 24 + COALESCE(c.closing_stock_loose, 0)
    + COALESCE(d.bottles, 0) - COALESCE(r.returned_bottles, 0)) / 24) AS closing_crates,
  MOD((COALESCE(c.closing_stock_crates, 0) * 24 + COALESCE(c.closing_stock_loose, 0)
    + COALESCE(d.bottles, 0) - COALESCE(r.returned_bottles, 0)), 24) AS closing_loose
FROM public.customers c
LEFT JOIN delivered d ON d.customer_id = c.id
LEFT JOIN returns   r ON r.customer_id = c.id;

COMMENT ON VIEW public.hotel_closing_stock IS
  'Unified closing-stock ledger per hotel: opening + delivered (from bill items JSONB) - returned (from crate_entries). 24 bottles/crate for Goli Fizz/Blast, 30 for Petbottle. Identical to the app frontend calculation.';

GRANT SELECT ON public.hotel_closing_stock TO authenticated;

-- ------------------------------------------------------------------
-- hotel_closing_stock_before_bill(bill_id)
--   Returns the closing stock for a customer EXCLUDING a specific bill's
--   delivery and its synced crate-entry.  Used by the thermal print to
--   show "Previous Closing Stock" (the stock the hotel held before this
--   bill's items were delivered and before this bill's returns).
-- ------------------------------------------------------------------
-- Drop any leftover old-signature overload (an earlier version of this
-- migration declared the parameter as `text` instead of `uuid`) so we don't
-- end up with two overloaded functions of the same name sitting side by side.
DROP FUNCTION IF EXISTS public.hotel_closing_stock_before_bill(text);

CREATE OR REPLACE FUNCTION public.hotel_closing_stock_before_bill(p_bill_id uuid)
RETURNS TABLE (customer_id text, closing_bottles numeric, closing_crates numeric, closing_loose numeric)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH target AS (
    SELECT customer_id FROM public.bills WHERE id = p_bill_id LIMIT 1
  ),
  delivered AS (
    SELECT b.customer_id,
      COALESCE(SUM(
        COALESCE((it->>'crates')::numeric, 0) *
          CASE WHEN it->>'category' = 'Petbottle' THEN 30 ELSE 24 END
        + COALESCE((it->>'loose')::numeric, 0)
      ), 0) AS bottles
    FROM public.bills b,
      jsonb_array_elements(COALESCE(b.items, '[]'::jsonb)) AS it
    WHERE b.id <> p_bill_id
    GROUP BY b.customer_id
  ),
  returns AS (
    SELECT customer_id,
      COALESCE(SUM(crates_returned), 0) * 24
      + COALESCE(SUM(loose_bottles_returned), 0)
      + COALESCE(SUM(damaged_bottles), 0) AS returned_bottles
    FROM public.crate_entries
    WHERE bill_id <> p_bill_id OR bill_id IS NULL
    GROUP BY customer_id
  )
  SELECT
    c.id::text,
    (COALESCE(c.closing_stock_crates, 0) * 24 + COALESCE(c.closing_stock_loose, 0)
      + COALESCE(d.bottles, 0) - COALESCE(r.returned_bottles, 0)),
    FLOOR((COALESCE(c.closing_stock_crates, 0) * 24 + COALESCE(c.closing_stock_loose, 0)
      + COALESCE(d.bottles, 0) - COALESCE(r.returned_bottles, 0)) / 24),
    MOD((COALESCE(c.closing_stock_crates, 0) * 24 + COALESCE(c.closing_stock_loose, 0)
      + COALESCE(d.bottles, 0) - COALESCE(r.returned_bottles, 0)), 24)
  FROM public.customers c
  JOIN target t ON t.customer_id = c.id
  LEFT JOIN delivered d ON d.customer_id = c.id
  LEFT JOIN returns   r ON r.customer_id = c.id;
$$;

GRANT EXECUTE ON FUNCTION public.hotel_closing_stock_before_bill(uuid) TO authenticated;

-- ===================================================================
-- End of migration
-- ===================================================================


-- ============================== 007_live_locations_admin_write.sql ==============================

-- =====================================================================
-- SVB — Admin write access for live tracking
-- File: supabase/migrations/007_live_locations_admin_write.sql
-- Additive to 001_location_schema.sql.
--
-- Bug fixed: live_locations only had a self-write policy (a user can only
-- update their own row) plus an admin *read* policy. That meant an admin
-- tapping "High-freq live" in Location Tracking — which runs
-- `update live_locations set is_live_active = true where user_id = <driver>`
-- as the ADMIN's session — was silently blocked by RLS (0 rows updated, no
-- visible error). locationService.js's realtime subscription then never
-- sees the flag flip, so the driver's device never starts high-accuracy
-- watchPosition tracking. This adds the missing admin write policy, using
-- the same non-recursive public.is_admin() helper as every other admin
-- policy in this schema.
-- =====================================================================

drop policy if exists "live admin write" on public.live_locations;
create policy "live admin write" on public.live_locations for update
  using (public.is_admin())
  with check (public.is_admin());

-- ===================================================================
-- End of migration
-- ===================================================================


-- ============================== 008_bills_customer_name.sql ==============================

-- =====================================================================
-- SVB — bills.customer_name
-- File: supabase/migrations/008_bills_customer_name.sql
--
-- Bug fixed: the app writes/reads a denormalized `customer_name` on every
-- bill (same pattern already used by `deliveries.customer_name` and
-- `crate_entries.customer_name`), e.g. Orders.jsx's "Mark Dispatched" flow
-- creates a bill with `customer_name: o.customer_name`. The `bills` table
-- never had this column, so PostgREST rejected the insert with:
--   "Could not find the 'customer_name' column of 'bills' in the schema cache"
-- =====================================================================

alter table public.bills add column if not exists customer_name text;

-- Backfill existing bills from their linked customer, best-effort.
update public.bills b
set customer_name = c.customer_name
from public.customers c
where b.customer_id = c.id
  and b.customer_name is null;

-- ===================================================================
-- End of migration
-- ===================================================================


-- ============================== 009_shared_row_update_delete.sql ==============================

-- =====================================================================
-- SVB — Allow updating/deleting shared (ownerless) rows
-- File: supabase/migrations/009_shared_row_update_delete.sql
--
-- Bug fixed: every *_select policy on these tables already allowed
-- `user_id is null` (rows nobody "owns" are visible to any signed-in
-- user), but the matching *_update / *_delete policies never got the
-- same allowance — they only checked `user_id = auth.uid() or
-- is_admin()`. Since the frontend never actually sets `user_id` when
-- creating a customer, product, invoice series, bill, delivery, crate
-- entry, daily production, or order (grep the codebase — it's simply
-- never passed), every one of those rows has `user_id = null`. Result:
-- no non-admin user could ever update or delete ANY of these rows —
-- e.g. Bill Entries' "Save Entries" / "Mark Delivered" silently failed
-- for any signed-in user who isn't an admin, because the UPDATE matched
-- zero rows under RLS and PostgREST's `.select().single()` then threw
-- "JSON object requested, multiple (or no) rows returned" — uncaught,
-- so nothing visibly happened.
--
-- Fix: bring *_update and *_delete in line with their *_select sibling
-- on every affected table.
-- =====================================================================

drop policy if exists "customers_update" on public.customers;
create policy "customers_update" on public.customers for update
  using (user_id = auth.uid() or public.is_admin() or user_id is null);
drop policy if exists "customers_delete" on public.customers;
create policy "customers_delete" on public.customers for delete
  using (user_id = auth.uid() or public.is_admin() or user_id is null);

drop policy if exists "products_update" on public.products;
create policy "products_update" on public.products for update
  using (user_id = auth.uid() or public.is_admin() or user_id is null);
drop policy if exists "products_delete" on public.products;
create policy "products_delete" on public.products for delete
  using (user_id = auth.uid() or public.is_admin() or user_id is null);

drop policy if exists "invoice_series_update" on public.invoice_series;
create policy "invoice_series_update" on public.invoice_series for update
  using (user_id = auth.uid() or public.is_admin() or user_id is null);
drop policy if exists "invoice_series_delete" on public.invoice_series;
create policy "invoice_series_delete" on public.invoice_series for delete
  using (user_id = auth.uid() or public.is_admin() or user_id is null);

drop policy if exists "bills_update" on public.bills;
create policy "bills_update" on public.bills for update
  using (user_id = auth.uid() or public.is_admin() or user_id is null);
drop policy if exists "bills_delete" on public.bills;
create policy "bills_delete" on public.bills for delete
  using (user_id = auth.uid() or public.is_admin() or user_id is null);

drop policy if exists "deliveries_update" on public.deliveries;
create policy "deliveries_update" on public.deliveries for update
  using (user_id = auth.uid() or public.is_admin() or user_id is null);
drop policy if exists "deliveries_delete" on public.deliveries;
create policy "deliveries_delete" on public.deliveries for delete
  using (user_id = auth.uid() or public.is_admin() or user_id is null);

drop policy if exists "crate_entries_update" on public.crate_entries;
create policy "crate_entries_update" on public.crate_entries for update
  using (user_id = auth.uid() or public.is_admin() or user_id is null);
drop policy if exists "crate_entries_delete" on public.crate_entries;
create policy "crate_entries_delete" on public.crate_entries for delete
  using (user_id = auth.uid() or public.is_admin() or user_id is null);

drop policy if exists "daily_productions_update" on public.daily_productions;
create policy "daily_productions_update" on public.daily_productions for update
  using (user_id = auth.uid() or public.is_admin() or user_id is null);
drop policy if exists "daily_productions_delete" on public.daily_productions;
create policy "daily_productions_delete" on public.daily_productions for delete
  using (user_id = auth.uid() or public.is_admin() or user_id is null);

drop policy if exists "orders_update" on public.orders;
create policy "orders_update" on public.orders for update
  using (user_id = auth.uid() or public.is_admin() or user_id is null);
drop policy if exists "orders_delete" on public.orders;
create policy "orders_delete" on public.orders for delete
  using (user_id = auth.uid() or public.is_admin() or user_id is null);

-- Note: daily_summaries is intentionally left as-is (strictly
-- self-owned — DailySummary.jsx always sets user_id: user.id on create),
-- as are profiles (owner IS the row id) and live_locations/
-- location_history (handled by their own admin-write migration).

-- ===================================================================
-- End of migration
-- ===================================================================

