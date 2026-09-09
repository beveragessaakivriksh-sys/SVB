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
