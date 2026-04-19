-- Super Admin setup for Budgetly
-- Run this after the main schema if these tables do not exist yet.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  role text not null default 'user' check (role in ('user','admin','super_admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_feature_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  dashboard boolean not null default true,
  transactions boolean not null default true,
  categories boolean not null default true,
  recurring boolean not null default true,
  reports boolean not null default true,
  goals boolean not null default true,
  advice boolean not null default true,
  converter boolean not null default true,
  support boolean not null default true,
  settings boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'super_admin'
      and is_active = true
  );
$$;

create or replace function public.handle_new_user_profile()
returns trigger as $$
begin
  insert into public.profiles (id, email, role, is_active)
  values (new.id, coalesce(new.email, ''), 'user', true)
  on conflict (id) do nothing;

  insert into public.user_feature_access (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$ language plpgsql security definer;

create or replace function public.sync_profile_email()
returns trigger as $$
begin
  update public.profiles
  set email = coalesce(new.email, old.email, ''), updated_at = now()
  where id = new.id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute procedure public.handle_new_user_profile();

drop trigger if exists on_auth_user_updated_profile on auth.users;
create trigger on_auth_user_updated_profile
after update of email on auth.users
for each row execute procedure public.sync_profile_email();

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists set_user_feature_access_updated_at on public.user_feature_access;
create trigger set_user_feature_access_updated_at
before update on public.user_feature_access
for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.user_feature_access enable row level security;
alter table public.admin_audit_logs enable row level security;

-- Optional: allow Super Admin to read app-wide counts
drop policy if exists "categories_super_admin_select" on public.categories;
create policy "categories_super_admin_select"
on public.categories for select
using (public.is_super_admin());
drop policy if exists "transactions_super_admin_select" on public.transactions;
create policy "transactions_super_admin_select"
on public.transactions for select
using (public.is_super_admin());
drop policy if exists "recurring_items_super_admin_select" on public.recurring_items;
create policy "recurring_items_super_admin_select"
on public.recurring_items for select
using (public.is_super_admin());
drop policy if exists "goals_super_admin_select" on public.goals;
create policy "goals_super_admin_select"
on public.goals for select
using (public.is_super_admin());

drop policy if exists "profiles_self_select" on public.profiles;
create policy "profiles_self_select"
on public.profiles for select
using (auth.uid() = id or public.is_super_admin());

drop policy if exists "profiles_self_insert" on public.profiles;
create policy "profiles_self_insert"
on public.profiles for insert
with check (auth.uid() = id and role = 'user');

drop policy if exists "profiles_super_admin_update" on public.profiles;
create policy "profiles_super_admin_update"
on public.profiles for update
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists "user_feature_access_self_select" on public.user_feature_access;
create policy "user_feature_access_self_select"
on public.user_feature_access for select
using (auth.uid() = user_id or public.is_super_admin());

drop policy if exists "user_feature_access_self_insert" on public.user_feature_access;
create policy "user_feature_access_self_insert"
on public.user_feature_access for insert
with check (auth.uid() = user_id);

drop policy if exists "user_feature_access_super_admin_update" on public.user_feature_access;
create policy "user_feature_access_super_admin_update"
on public.user_feature_access for update
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists "admin_audit_logs_super_admin_select" on public.admin_audit_logs;
create policy "admin_audit_logs_super_admin_select"
on public.admin_audit_logs for select
using (public.is_super_admin());

drop policy if exists "admin_audit_logs_super_admin_insert" on public.admin_audit_logs;
create policy "admin_audit_logs_super_admin_insert"
on public.admin_audit_logs for insert
with check (public.is_super_admin() and admin_user_id = auth.uid());

create index if not exists idx_profiles_role_active on public.profiles(role, is_active);
create index if not exists idx_admin_audit_logs_created on public.admin_audit_logs(created_at desc);

-- Promote your real admin account after it already exists in auth.users.
-- Replace the email below with your real admin email.
update public.profiles
set role = 'super_admin', is_active = true
where email = 'mainali.aswin88@gmail.com';
