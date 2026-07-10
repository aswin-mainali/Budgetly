-- ============================================================================
-- Budgetly — Super Admin panel: apply ALL pending database changes at once.
-- Safe to run multiple times (idempotent). Run this once in the Supabase
-- SQL editor (Dashboard > SQL Editor > New query > paste > Run).
-- ============================================================================

-- 1) Investments feature toggle -------------------------------------------------
alter table public.user_feature_access
  add column if not exists investments boolean not null default true;

-- 2) Let super admins actually delete users (Danger zone > Remove user) ---------
drop policy if exists "profiles_super_admin_delete" on public.profiles;
create policy "profiles_super_admin_delete"
on public.profiles for delete
using (public.is_super_admin());

drop policy if exists "user_feature_access_super_admin_delete" on public.user_feature_access;
create policy "user_feature_access_super_admin_delete"
on public.user_feature_access for delete
using (public.is_super_admin());

-- 3) Accurate "Last active" -----------------------------------------------------
-- 3a) Real last sign-in time (retroactive, works immediately for all users).
create or replace function public.admin_user_activity()
returns table (id uuid, last_sign_in_at timestamptz, auth_created_at timestamptz)
language sql
security definer
set search_path = public, auth
as $$
  select u.id, u.last_sign_in_at, u.created_at
  from auth.users u
  where public.is_super_admin();
$$;

grant execute on function public.admin_user_activity() to authenticated;

-- 3b) Optional forward-looking freshness: each session stamps its own last_active_at.
alter table public.profiles
  add column if not exists last_active_at timestamptz;

create or replace function public.touch_last_active()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set last_active_at = now() where id = auth.uid();
$$;

grant execute on function public.touch_last_active() to authenticated;
