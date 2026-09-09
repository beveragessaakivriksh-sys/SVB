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
