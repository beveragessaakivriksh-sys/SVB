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
