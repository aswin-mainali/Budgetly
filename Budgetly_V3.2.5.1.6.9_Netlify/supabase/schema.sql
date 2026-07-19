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
  receipt_url text,
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

create table if not exists public.user_account_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  image_url text,
  walkthrough_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure the walkthrough column exists on pre-existing installs.
alter table public.user_account_profiles
  add column if not exists walkthrough_completed_at timestamptz;



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
  category text,
  details jsonb,
  "before" jsonb,
  "after" jsonb,
  actor_email text,
  target_email text,
  ip_address text,
  user_agent text,
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

drop trigger if exists set_user_account_profiles_updated_at on public.user_account_profiles;
create trigger set_user_account_profiles_updated_at
before update on public.user_account_profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists set_bug_reports_updated_at on public.bug_reports;
create trigger set_bug_reports_updated_at
before update on public.bug_reports
for each row execute procedure public.set_updated_at();

-- Advanced audit logging: capture super-admin changes server-side with an exact
-- before -> after diff, plus request context (IP / user-agent).
create or replace function public.audit_request_ip()
returns text
language plpgsql
stable
as $$
declare
  v_headers jsonb;
begin
  begin
    v_headers := current_setting('request.headers', true)::jsonb;
  exception when others then
    return null;
  end;
  if v_headers is null then return null; end if;
  return nullif(trim(split_part(coalesce(v_headers->>'x-forwarded-for', v_headers->>'x-real-ip', ''), ',', 1)), '');
end;
$$;

create or replace function public.audit_request_ua()
returns text
language plpgsql
stable
as $$
declare
  v_headers jsonb;
begin
  begin
    v_headers := current_setting('request.headers', true)::jsonb;
  exception when others then
    return null;
  end;
  if v_headers is null then return null; end if;
  return v_headers->>'user-agent';
end;
$$;

create or replace function public.record_admin_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_action text;
  v_category text;
  v_target uuid;
  v_old jsonb;
  v_new jsonb;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_key text;
  v_ignore text[];
  v_actor_email text;
  v_target_email text;
begin
  if v_actor is null or not public.is_super_admin() then
    return coalesce(new, old);
  end if;

  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new := case when tg_op in ('UPDATE', 'INSERT') then to_jsonb(new) else null end;

  if tg_table_name = 'profiles' then
    v_target := coalesce((v_new->>'id')::uuid, (v_old->>'id')::uuid);
    if tg_op = 'DELETE' then
      v_category := 'user';
      v_action := 'user_removed';
    else
      v_category := 'profile';
      v_action := 'profile_update';
    end if;
    v_ignore := array['updated_at', 'created_at', 'id', 'last_active_at'];
  elsif tg_table_name = 'user_feature_access' then
    v_category := 'feature';
    v_target := coalesce((v_new->>'user_id')::uuid, (v_old->>'user_id')::uuid);
    v_action := 'feature_access_update';
    v_ignore := array['updated_at', 'created_at', 'user_id'];
  elsif tg_table_name = 'bug_reports' then
    v_category := 'bug';
    v_target := coalesce((v_new->>'user_id')::uuid, (v_old->>'user_id')::uuid);
    v_action := 'bug_report_update';
    v_ignore := array['updated_at', 'created_at', 'id', 'user_id', 'screenshot_data_url', 'diagnostics'];
  else
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key = any(v_ignore) then continue; end if;
      if v_old->v_key is distinct from v_new->v_key then
        v_before := v_before || jsonb_build_object(v_key, v_old->v_key);
        v_after := v_after || jsonb_build_object(v_key, v_new->v_key);
      end if;
    end loop;
    if v_before = '{}'::jsonb then
      return new;
    end if;
  elsif tg_op = 'DELETE' then
    v_before := jsonb_strip_nulls(jsonb_build_object(
      'email', v_old->'email',
      'role', v_old->'role',
      'is_active', v_old->'is_active'
    ));
    v_after := null;
  elsif tg_op = 'INSERT' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key = any(v_ignore) then continue; end if;
      v_after := v_after || jsonb_build_object(v_key, v_new->v_key);
    end loop;
    v_before := null;
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;
  select email into v_target_email from public.profiles where id = v_target;
  if v_target_email is null then
    v_target_email := coalesce(v_before->>'email', v_after->>'email');
  end if;

  insert into public.admin_audit_logs (
    admin_user_id, target_user_id, action, category,
    details, "before", "after",
    actor_email, target_email, ip_address, user_agent
  ) values (
    v_actor, v_target, v_action, v_category,
    coalesce(v_after, v_before, '{}'::jsonb), v_before, v_after,
    v_actor_email, v_target_email, public.audit_request_ip(), public.audit_request_ua()
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_profiles_changes on public.profiles;
create trigger audit_profiles_changes
after update or delete on public.profiles
for each row execute procedure public.record_admin_audit();

drop trigger if exists audit_feature_access_changes on public.user_feature_access;
create trigger audit_feature_access_changes
after insert or update on public.user_feature_access
for each row execute procedure public.record_admin_audit();

drop trigger if exists audit_bug_reports_changes on public.bug_reports;
create trigger audit_bug_reports_changes
after update on public.bug_reports
for each row execute procedure public.record_admin_audit();

create or replace function public.log_admin_action(
  p_action text,
  p_category text,
  p_target_user_id uuid,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_email text;
  v_target_email text;
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can write audit entries.';
  end if;

  select email into v_actor_email from public.profiles where id = auth.uid();
  select email into v_target_email from public.profiles where id = p_target_user_id;

  insert into public.admin_audit_logs (
    admin_user_id, target_user_id, action, category,
    details, "after", actor_email, target_email, ip_address, user_agent
  ) values (
    auth.uid(), p_target_user_id, p_action, coalesce(p_category, 'admin'),
    coalesce(p_details, '{}'::jsonb), coalesce(p_details, '{}'::jsonb),
    v_actor_email, v_target_email, public.audit_request_ip(), public.audit_request_ua()
  );
end;
$$;

grant execute on function public.log_admin_action(text, text, uuid, jsonb) to authenticated;

alter table public.profiles enable row level security;
alter table public.user_feature_access enable row level security;
alter table public.user_account_profiles enable row level security;
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

drop policy if exists "user_account_profiles_self_select" on public.user_account_profiles;
create policy "user_account_profiles_self_select"
on public.user_account_profiles for select
using (auth.uid() = user_id or public.is_super_admin());

drop policy if exists "user_account_profiles_self_insert" on public.user_account_profiles;
create policy "user_account_profiles_self_insert"
on public.user_account_profiles for insert
with check (auth.uid() = user_id);

drop policy if exists "user_account_profiles_self_update" on public.user_account_profiles;
create policy "user_account_profiles_self_update"
on public.user_account_profiles for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "user_account_profiles_self_delete" on public.user_account_profiles;
create policy "user_account_profiles_self_delete"
on public.user_account_profiles for delete
using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-images',
  'profile-images',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile_images_owner_select" on storage.objects;
create policy "profile_images_owner_select"
on storage.objects for select
using (
  bucket_id = 'profile-images'
  and auth.uid()::text = split_part(name, '/', 1)
);

drop policy if exists "profile_images_owner_insert" on storage.objects;
create policy "profile_images_owner_insert"
on storage.objects for insert
with check (
  bucket_id = 'profile-images'
  and auth.uid()::text = split_part(name, '/', 1)
);

drop policy if exists "profile_images_owner_update" on storage.objects;
create policy "profile_images_owner_update"
on storage.objects for update
using (
  bucket_id = 'profile-images'
  and auth.uid()::text = split_part(name, '/', 1)
)
with check (
  bucket_id = 'profile-images'
  and auth.uid()::text = split_part(name, '/', 1)
);

drop policy if exists "profile_images_owner_delete" on storage.objects;
create policy "profile_images_owner_delete"
on storage.objects for delete
using (
  bucket_id = 'profile-images'
  and auth.uid()::text = split_part(name, '/', 1)
);

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
create index if not exists idx_user_account_profiles_updated on public.user_account_profiles(updated_at desc);
create index if not exists idx_bug_reports_created on public.bug_reports(created_at desc);
create index if not exists idx_admin_audit_logs_created on public.admin_audit_logs(created_at desc);
create index if not exists idx_admin_audit_logs_action on public.admin_audit_logs(action);
create index if not exists idx_admin_audit_logs_category on public.admin_audit_logs(category);
create index if not exists idx_admin_audit_logs_admin on public.admin_audit_logs(admin_user_id);
create index if not exists idx_admin_audit_logs_target on public.admin_audit_logs(target_user_id);
