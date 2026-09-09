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