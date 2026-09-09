-- =====================================================================
-- SVB — Self-service account roles (admin at signup, no approval)
-- File: supabase/migrations/004_admin_signup_no_approval.sql
-- Additive to 001–003. Reflects the app changes:
--   * Create Account: selecting "Admin" applies the role immediately —
--     no approval by an existing admin, no password restrictions.
--   * Thermal print bills (GST + non-GST): quantity is displayed as
--     Crates + Loose bottles — items already store {crates, loose} in
--     bills.items / orders.items jsonb, so no schema change is needed.
-- =====================================================================

-- ------------------------------------------------------------------
-- 1. handle_new_user — honour the account type chosen at signup
--    (raw_user_meta_data->>'role'), validated, applied immediately.
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

-- ------------------------------------------------------------------
-- 2. set_my_role(role) — lets any signed-in user set their own role
--    ('admin' or 'user'). SVB policy: no approval by an existing admin.
-- ------------------------------------------------------------------
create or replace function public.set_my_role(p_role text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
begin
  if lower(coalesce(p_role, '')) = 'admin' then
    v_role := 'admin';
  else
    v_role := 'user';
  end if;

  update public.profiles
  set role = v_role
  where id = auth.uid();

  return v_role;
end;
$$;

grant execute on function public.set_my_role(text) to authenticated;

-- ===================================================================
-- End of migration
-- ===================================================================