-- =====================================================================
-- SVB — Hotels belonging to a distributor
-- File: supabase/migrations/012_distributor_hotels.sql
--
-- Adds:
--   * public.distributor_hotels — hotels managed under a distributor in the
--     Distributors tab. Same GST/billing/pricing shape as customers, but
--     linked to a distributor rather than being global customers.
--   * orders/bills/deliveries.distributor_hotel_id so a distributor order
--     keeps the hotel it was entered for (the bill-to party).
--
-- Safe to run more than once.
-- =====================================================================

create table if not exists public.distributor_hotels (
  id                         uuid primary key default uuid_generate_v4(),
  user_id                    uuid references auth.users(id) on delete cascade,
  distributor_id             uuid not null references public.distributors(id) on delete cascade,
  hotel_name                 text not null,
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
  petbottle_mrp              numeric not null default 0,
  payment_terms_label        text default 'Due on Receipt',
  closing_stock_crates       integer not null default 0,
  closing_stock_loose        integer not null default 0,
  product_prices             jsonb not null default '{}',
  notes                      text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

drop trigger if exists trg_distributor_hotels_updated on public.distributor_hotels;
create trigger trg_distributor_hotels_updated
before update on public.distributor_hotels
for each row execute function public.touch_updated_at();

create index if not exists idx_distributor_hotels_distributor_id on public.distributor_hotels(distributor_id);
create index if not exists idx_distributor_hotels_user_id on public.distributor_hotels(user_id);

alter table public.distributor_hotels enable row level security;

drop policy if exists "distributor_hotels_select" on public.distributor_hotels;
create policy "distributor_hotels_select" on public.distributor_hotels for select
  using (user_id = auth.uid() or public.is_admin() or user_id is null);
drop policy if exists "distributor_hotels_insert" on public.distributor_hotels;
create policy "distributor_hotels_insert" on public.distributor_hotels for insert
  with check (user_id = auth.uid() or public.is_admin());
drop policy if exists "distributor_hotels_update" on public.distributor_hotels;
create policy "distributor_hotels_update" on public.distributor_hotels for update
  using (user_id = auth.uid() or public.is_admin() or user_id is null);
drop policy if exists "distributor_hotels_delete" on public.distributor_hotels;
create policy "distributor_hotels_delete" on public.distributor_hotels for delete
  using (user_id = auth.uid() or public.is_admin() or user_id is null);

-- ------------------------------------------------------------------
-- Keep the hotel reference on the order / invoice / delivery
-- ------------------------------------------------------------------
alter table public.orders add column if not exists distributor_hotel_id uuid references public.distributor_hotels(id) on delete set null;
alter table public.bills add column if not exists distributor_hotel_id uuid references public.distributor_hotels(id) on delete set null;
alter table public.deliveries add column if not exists distributor_hotel_id uuid references public.distributor_hotels(id) on delete set null;

create index if not exists idx_orders_distributor_hotel_id     on public.orders(distributor_hotel_id);
create index if not exists idx_bills_distributor_hotel_id      on public.bills(distributor_hotel_id);
create index if not exists idx_deliveries_distributor_hotel_id on public.deliveries(distributor_hotel_id);

-- ===================================================================
-- End of migration
-- ===================================================================
