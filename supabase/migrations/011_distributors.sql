-- =====================================================================
-- SVB — Distributor access, per-distributor invoice numbers,
--       delivery dates and admin order notifications
-- File: supabase/migrations/011_distributor_access_and_notifications.sql
-- Additive to 001–010. Run via `supabase db push` or paste into the
-- Supabase SQL editor.
--
--   * profiles.role can be 'distributor'; profiles.distributor_id links the
--     account to one distributor (assigned by an admin in Settings).
--   * Each distributor owns its own invoice prefix + counter, so distributor
--     invoice numbers are unique per distributor instead of sharing one
--     global DST- sequence.
--   * orders.delivery_date stores the date chosen in Distributor Incoming
--     Orders.
--   * Inserting a distributor order pushes an in-app notification to every
--     admin and is also published as a Supabase Realtime event.
-- =====================================================================

-- ------------------------------------------------------------------
-- 1. Signup: honour the "distributor" account type. Existing logic maps
--    everything except admin to 'user', so replace the trigger function.
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
      when lower(coalesce(new.raw_user_meta_data->>'role', '')) = 'distributor' then 'distributor'
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

-- set_my_role stays 'admin'/'user' only: a distributor account can never
-- promote itself, and an admin assignment is the only way to obtain the
-- distributor role. (Self-service admin remains the existing project policy.)

-- ------------------------------------------------------------------
-- 2. profile -> distributor link (admin assigns it in Settings)
-- ------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'distributor_id'
  ) then
    alter table public.profiles add column distributor_id uuid;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'distributors'
  ) and not exists (
    select 1 from pg_constraint where conname = 'profiles_distributor_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_distributor_id_fkey
      foreign key (distributor_id) references public.distributors(id) on delete set null;
  end if;
end $$;

-- ------------------------------------------------------------------
-- 3. Per-distributor invoice series (columns on the distributor row,
--    because invoice_series.type is UNIQUE and cannot hold many series of
--    the same type).
-- ------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'distributors'
  ) then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'distributors' and column_name = 'invoice_prefix'
    ) then
      alter table public.distributors
        add column invoice_prefix text not null default 'DST-';
    end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'distributors' and column_name = 'invoice_next_number'
    ) then
      alter table public.distributors
        add column invoice_next_number integer not null default 1001;
    end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'distributors' and column_name = 'invoice_padding'
    ) then
      alter table public.distributors
        add column invoice_padding integer not null default 4;
    end if;
  end if;
end $$;

-- ------------------------------------------------------------------
-- 4. Delivery date chosen when a distributor order is placed.
-- ------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'delivery_date'
  ) then
    alter table public.orders add column delivery_date date;
  end if;
end $$;

-- ------------------------------------------------------------------
-- 5. Admin notifications
-- ------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  body        text not null default '',
  data        jsonb not null default '{}'::jsonb,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists idx_notifications_user_created
  on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;

-- Only the recipient may see/mark/delete a notification. There is
-- deliberately NO insert policy for clients: rows are created by the trigger
-- below, so users cannot forge admin notifications.
drop policy if exists "notifications_select" on public.notifications;
create policy "notifications_select" on public.notifications for select
  using (user_id = auth.uid());

drop policy if exists "notifications_update" on public.notifications;
create policy "notifications_update" on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "notifications_delete" on public.notifications;
create policy "notifications_delete" on public.notifications for delete
  using (user_id = auth.uid());

-- Push a notification to every admin whenever a distributor order is created.
create or replace function public.notify_admins_new_distributor_order()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (new.party_type = 'distributor' or new.distributor_id is not null) then
    insert into public.notifications (user_id, title, body, data)
    select
      p.id,
      'New distributor order',
      coalesce(nullif(new.display_name, ''), new.customer_name, 'Distributor')
        || ' placed an order for '
        || coalesce(to_char(new.order_date, 'DD Mon YYYY'), 'today'),
      jsonb_build_object(
        'order_id', new.id,
        'internal_invoice_number', new.internal_invoice_number,
        'distributor_id', new.distributor_id,
        'delivery_date', new.delivery_date
      )
    from public.profiles p
    where p.role = 'admin';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_admin_new_distributor_order on public.orders;
create trigger trg_notify_admin_new_distributor_order
after insert on public.orders
for each row execute function public.notify_admins_new_distributor_order();

-- Realtime so an open admin session receives the notification immediately.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ------------------------------------------------------------------
-- 6. Atomic per-distributor invoice counter (mirrors invoiceSeries.js)
-- ------------------------------------------------------------------
create or replace function public.next_distributor_invoice_number(p_distributor_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_prefix  text;
  v_next    integer;
  v_padding integer;
begin
  select coalesce(invoice_prefix, 'DIST-'),
         coalesce(invoice_next_number, 1001),
         coalesce(invoice_padding, 4)
    into v_prefix, v_next, v_padding
    from public.distributors
   where id = p_distributor_id;

  if not found then
    raise exception 'Distributor % not found', p_distributor_id;
  end if;

  update public.distributors
     set invoice_next_number = v_next + 1
   where id = p_distributor_id;

  return v_prefix || lpad(v_next::text, v_padding, '0');
end;
$$;

grant execute on function public.next_distributor_invoice_number(uuid) to authenticated;

-- ===================================================================
-- End of migration
-- ===================================================================
