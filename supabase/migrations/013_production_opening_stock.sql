-- =====================================================================
-- SVB — Morning factory stock for the production plan
-- File: supabase/migrations/013_production_opening_stock.sql
--
-- Adds a jsonb column to daily_productions holding the crates+loose counted
-- at the factory in the morning, per category/flavour:
--   [{ "category": "Goli Fizz", "flavour": "Orange", "crates": 2, "loose": 5 }]
-- The production requirement is derived in the frontend from this stock and
-- that day's orders, so no other table changes are needed.
--
-- Safe to run more than once.
-- =====================================================================

alter table public.daily_productions
  add column if not exists opening_stock jsonb not null default '[]';

comment on column public.daily_productions.opening_stock is
  'Morning factory stock in crates + loose bottles per category/flavour.';

-- ===================================================================
-- End of migration
-- ===================================================================
