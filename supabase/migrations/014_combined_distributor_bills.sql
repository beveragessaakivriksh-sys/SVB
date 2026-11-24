-- =====================================================================
-- SVB — Combined distributor bills
-- File: supabase/migrations/014_combined_distributor_bills.sql
-- Additive to 001-013.
--
-- Several hotel orders of the same distributor (and the same dispatch
-- date) now share ONE bill in Bill Entries. Each hotel still gets its own
-- delivery, so deliveries need to remember which order produced them in
-- order to un-dispatch just that hotel's line items from the combined bill.
-- =====================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'deliveries' and column_name = 'order_id'
  ) then
    alter table public.deliveries add column order_id uuid;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'orders'
  ) and not exists (
    select 1 from pg_constraint where conname = 'deliveries_order_id_fkey'
  ) then
    alter table public.deliveries
      add constraint deliveries_order_id_fkey
      foreign key (order_id) references public.orders(id) on delete set null;
  end if;
end $$;

create index if not exists idx_deliveries_order_id on public.deliveries(order_id);

-- ===================================================================
-- End of migration
-- ===================================================================
