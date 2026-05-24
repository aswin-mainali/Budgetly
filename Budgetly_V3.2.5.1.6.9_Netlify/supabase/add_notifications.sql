create extension if not exists "pgcrypto";

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  section text not null check (section in ('action_needed','upcoming','insights','system')),
  title text not null,
  message text not null,
  type text not null,
  status text not null default 'unread' check (status in ('unread','read')),
  action_label text,
  action_target text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  bills_recurring boolean not null default true,
  budgets boolean not null default true,
  subscriptions boolean not null default true,
  goals boolean not null default true,
  investments boolean not null default true,
  net_worth boolean not null default true,
  monthly_reports boolean not null default true,
  system_updates boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;

create policy if not exists "notifications_own_all" on public.notifications for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy if not exists "notification_prefs_select" on public.notification_preferences for select using (auth.uid() = user_id);
create policy if not exists "notification_prefs_insert" on public.notification_preferences for insert with check (auth.uid() = user_id);
create policy if not exists "notification_prefs_update" on public.notification_preferences for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
