-- =====================================================================
-- SVB — Admin write access for live tracking
-- File: supabase/migrations/007_live_locations_admin_write.sql
-- Additive to 001_location_schema.sql.
--
-- Bug fixed: live_locations only had a self-write policy (a user can only
-- update their own row) plus an admin *read* policy. That meant an admin
-- tapping "High-freq live" in Location Tracking — which runs
-- `update live_locations set is_live_active = true where user_id = <driver>`
-- as the ADMIN's session — was silently blocked by RLS (0 rows updated, no
-- visible error). locationService.js's realtime subscription then never
-- sees the flag flip, so the driver's device never starts high-accuracy
-- watchPosition tracking. This adds the missing admin write policy, using
-- the same non-recursive public.is_admin() helper as every other admin
-- policy in this schema.
-- =====================================================================

drop policy if exists "live admin write" on public.live_locations;
create policy "live admin write" on public.live_locations for update
  using (public.is_admin())
  with check (public.is_admin());

-- ===================================================================
-- End of migration
-- ===================================================================
