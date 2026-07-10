-- Fixes for the Super Admin panel:
--   1. Let super admins actually delete users (Danger zone > Remove user).
--      Without a DELETE policy, RLS silently drops the delete (0 rows) and the
--      client sees a false success while the user stays in the directory.
--   2. Track a real "last active" timestamp per user, stamped by the user's own
--      session on load, instead of showing profiles.updated_at.

-- 1) Super admin delete policies -------------------------------------------------
drop policy if exists "profiles_super_admin_delete" on public.profiles;
create policy "profiles_super_admin_delete"
on public.profiles for delete
using (public.is_super_admin());

drop policy if exists "user_feature_access_super_admin_delete" on public.user_feature_access;
create policy "user_feature_access_super_admin_delete"
on public.user_feature_access for delete
using (public.is_super_admin());

-- 2) Real last-active tracking ---------------------------------------------------
alter table public.profiles
  add column if not exists last_active_at timestamptz;

-- Seed existing rows with a sensible starting value.
update public.profiles
set last_active_at = coalesce(last_active_at, updated_at, created_at)
where last_active_at is null;

-- Each authenticated user can stamp their own last_active_at via this function.
-- SECURITY DEFINER so it works even though users cannot directly UPDATE profiles.
create or replace function public.touch_last_active()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set last_active_at = now() where id = auth.uid();
$$;

grant execute on function public.touch_last_active() to authenticated;
