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