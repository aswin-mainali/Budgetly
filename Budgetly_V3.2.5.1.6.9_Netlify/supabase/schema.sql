-- RaswiBudgeting schema (Supabase)
-- Run this in Supabase SQL editor.

-- 1) Tables
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text,
  emoji text,
  budget_monthly numeric not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  type text not null check (type in ('income','expense')),
  category_id uuid references public.categories(id) on delete set null,
  amount numeric not null check (amount >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recurring_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category_id uuid references public.categories(id) on delete set null,
  amount numeric not null check (amount >= 0),
  kind text not null default 'expense' check (kind in ('expense','income')),
  recurrence_type text not null default 'monthly' check (recurrence_type in ('monthly','weekly','biweekly')),
  day_of_month int not null check (day_of_month between 1 and 31),
  anchor_date date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  emoji text,
  target_amount numeric not null default 0 check (target_amount >= 0),
  current_amount numeric not null default 0 check (current_amount >= 0),
  target_date date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) updated_at trigger
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_categories_updated_at on public.categories;
create trigger set_categories_updated_at
before update on public.categories
for each row execute procedure public.set_updated_at();

drop trigger if exists set_transactions_updated_at on public.transactions;
create trigger set_transactions_updated_at
before update on public.transactions
for each row execute procedure public.set_updated_at();

drop trigger if exists set_recurring_items_updated_at on public.recurring_items;
create trigger set_recurring_items_updated_at
before update on public.recurring_items
for each row execute procedure public.set_updated_at();

drop trigger if exists set_goals_updated_at on public.goals;
create trigger set_goals_updated_at
before update on public.goals
for each row execute procedure public.set_updated_at();

-- 3) Row Level Security (RLS)
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.recurring_items enable row level security;
alter table public.goals enable row level security;

drop policy if exists "categories_owner_select" on public.categories;
create policy "categories_owner_select"
on public.categories for select
using (auth.uid() = user_id);

drop policy if exists "categories_owner_insert" on public.categories;
create policy "categories_owner_insert"
on public.categories for insert
with check (auth.uid() = user_id);

drop policy if exists "categories_owner_update" on public.categories;
create policy "categories_owner_update"
on public.categories for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "categories_owner_delete" on public.categories;
create policy "categories_owner_delete"
on public.categories for delete
using (auth.uid() = user_id);

drop policy if exists "transactions_owner_select" on public.transactions;
create policy "transactions_owner_select"
on public.transactions for select
using (auth.uid() = user_id);

drop policy if exists "transactions_owner_insert" on public.transactions;
create policy "transactions_owner_insert"
on public.transactions for insert
with check (auth.uid() = user_id);

drop policy if exists "transactions_owner_update" on public.transactions;
create policy "transactions_owner_update"
on public.transactions for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "transactions_owner_delete" on public.transactions;
create policy "transactions_owner_delete"
on public.transactions for delete
using (auth.uid() = user_id);

drop policy if exists "recurring_items_owner_select" on public.recurring_items;
create policy "recurring_items_owner_select"
on public.recurring_items for select
using (auth.uid() = user_id);

drop policy if exists "recurring_items_owner_insert" on public.recurring_items;
create policy "recurring_items_owner_insert"
on public.recurring_items for insert
with check (auth.uid() = user_id);

drop policy if exists "recurring_items_owner_update" on public.recurring_items;
create policy "recurring_items_owner_update"
on public.recurring_items for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "recurring_items_owner_delete" on public.recurring_items;
create policy "recurring_items_owner_delete"
on public.recurring_items for delete
using (auth.uid() = user_id);

drop policy if exists "goals_owner_select" on public.goals;
create policy "goals_owner_select"
on public.goals for select
using (auth.uid() = user_id);

drop policy if exists "goals_owner_insert" on public.goals;
create policy "goals_owner_insert"
on public.goals for insert
with check (auth.uid() = user_id);

drop policy if exists "goals_owner_update" on public.goals;
create policy "goals_owner_update"
on public.goals for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "goals_owner_delete" on public.goals;
create policy "goals_owner_delete"
on public.goals for delete
using (auth.uid() = user_id);

-- 4) Recommended indexes
create index if not exists idx_categories_user on public.categories(user_id);
create index if not exists idx_transactions_user_date on public.transactions(user_id, date);
create index if not exists idx_recurring_items_user_day on public.recurring_items(user_id, day_of_month);
create index if not exists idx_goals_user_created on public.goals(user_id, created_at);

-- 5) Optional: Realtime (enable in Supabase UI)
-- In Supabase: Database -> Replication -> enable for categories, transactions, recurring_items, and goals.

-- 6) Admin / role system
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



create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null default '',
  steps_to_reproduce text not null,
  contact_when_resolved boolean not null default false,
  screenshot_name text,
  screenshot_data_url text,
  status text not null default 'pending' check (status in ('pending','completed')),
  admin_notes text,
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

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists set_user_feature_access_updated_at on public.user_feature_access;
create trigger set_user_feature_access_updated_at
before update on public.user_feature_access
for each row execute procedure public.set_updated_at();

drop trigger if exists set_bug_reports_updated_at on public.bug_reports;
create trigger set_bug_reports_updated_at
before update on public.bug_reports
for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.user_feature_access enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.bug_reports enable row level security;

-- Allow Super Admin read access across user-owned app data
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



drop policy if exists "bug_reports_owner_select" on public.bug_reports;
create policy "bug_reports_owner_select"
on public.bug_reports for select
using (auth.uid() = user_id or public.is_super_admin());

drop policy if exists "bug_reports_owner_insert" on public.bug_reports;
create policy "bug_reports_owner_insert"
on public.bug_reports for insert
with check (auth.uid() = user_id and user_email = coalesce((select email from auth.users where id = auth.uid()), user_email));

drop policy if exists "bug_reports_super_admin_update" on public.bug_reports;
create policy "bug_reports_super_admin_update"
on public.bug_reports for update
using (public.is_super_admin())
with check (public.is_super_admin());

create index if not exists idx_profiles_role_active on public.profiles(role, is_active);
create index if not exists idx_bug_reports_created on public.bug_reports(created_at desc);
create index if not exists idx_admin_audit_logs_created on public.admin_audit_logs(created_at desc);
