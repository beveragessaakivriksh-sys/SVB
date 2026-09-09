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