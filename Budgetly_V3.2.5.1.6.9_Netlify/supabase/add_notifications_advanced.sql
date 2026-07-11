-- Advanced notification system enhancements.
-- Safe to run on top of add_notifications.sql (all changes are idempotent).

create extension if not exists "pgcrypto";

-- 1) Richer notification rows: severity, grouping/threading, TTL, archival, and
--    per-channel delivery tracking so a row is only pushed / emailed once.
alter table public.notifications add column if not exists priority text not null default 'normal'
  check (priority in ('critical', 'high', 'normal', 'low'));
alter table public.notifications add column if not exists group_key text;
alter table public.notifications add column if not exists expires_at timestamptz;
alter table public.notifications add column if not exists archived_at timestamptz;
alter table public.notifications add column if not exists pushed_at timestamptz;
alter table public.notifications add column if not exists emailed_at timestamptz;

create index if not exists idx_notifications_user_created on public.notifications(user_id, created_at desc);
create index if not exists idx_notifications_user_status on public.notifications(user_id, status);
create index if not exists idx_notifications_expires on public.notifications(expires_at) where expires_at is not null;
create index if not exists idx_notifications_group on public.notifications(user_id, group_key) where group_key is not null;
-- Fast dedupe lookups against metadata->>'dedupe_key'.
create index if not exists idx_notifications_metadata on public.notifications using gin (metadata jsonb_path_ops);

-- 2) Preference depth: delivery channels, quiet hours, digest cadence, severity
--    threshold, timezone, and a throttle marker for generation.
alter table public.notification_preferences add column if not exists channel_in_app boolean not null default true;
alter table public.notification_preferences add column if not exists channel_push boolean not null default false;
alter table public.notification_preferences add column if not exists channel_email boolean not null default false;
alter table public.notification_preferences add column if not exists quiet_hours_enabled boolean not null default false;
alter table public.notification_preferences add column if not exists quiet_hours_start smallint not null default 22
  check (quiet_hours_start between 0 and 23);
alter table public.notification_preferences add column if not exists quiet_hours_end smallint not null default 7
  check (quiet_hours_end between 0 and 23);
alter table public.notification_preferences add column if not exists email_digest_frequency text not null default 'weekly'
  check (email_digest_frequency in ('off', 'daily', 'weekly'));
alter table public.notification_preferences add column if not exists min_priority text not null default 'low'
  check (min_priority in ('critical', 'high', 'normal', 'low'));
alter table public.notification_preferences add column if not exists timezone text not null default 'UTC';
alter table public.notification_preferences add column if not exists last_generated_at timestamptz;
alter table public.notification_preferences add column if not exists last_digest_at timestamptz;

-- 3) Web Push subscriptions (one row per browser/device endpoint).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subscriptions_own" on public.push_subscriptions;
create policy "push_subscriptions_own" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists idx_push_subscriptions_user on public.push_subscriptions(user_id);

-- 4) Snooze / mute. A row with expires_at in the future = snoozed; null = muted forever.
--    mute_key can be a dedupe_key, a group_key, a category, or a notification type.
create table if not exists public.notification_mutes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mute_key text not null,
  scope text not null default 'dedupe' check (scope in ('dedupe', 'group', 'category', 'type')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, mute_key, scope)
);
alter table public.notification_mutes enable row level security;
drop policy if exists "notification_mutes_own" on public.notification_mutes;
create policy "notification_mutes_own" on public.notification_mutes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists idx_notification_mutes_user on public.notification_mutes(user_id);

-- 5) TTL cleanup: drop expired rows and auto-archive read rows older than 30 days.
create or replace function public.cleanup_expired_notifications()
returns void as $$
begin
  delete from public.notifications
    where expires_at is not null and expires_at < now();
  update public.notifications
    set archived_at = now()
    where archived_at is null
      and status = 'read'
      and read_at is not null
      and read_at < now() - interval '30 days';
  delete from public.notification_mutes
    where expires_at is not null and expires_at < now();
end;
$$ language plpgsql security definer;

-- 6) Optional scheduling with pg_cron (uncomment if the extension is enabled on your
--    project — Supabase: Database > Extensions > pg_cron).
--
--   create extension if not exists pg_cron;
--   -- Nightly cleanup at 03:00 UTC.
--   select cron.schedule('budgetly-notif-cleanup', '0 3 * * *',
--     $$ select public.cleanup_expired_notifications(); $$);
--   -- Hourly server-side generation via the Edge Function (uses pg_net + service role).
--   -- Replace <PROJECT_REF> and <SERVICE_ROLE_KEY>; prefer a Vault secret over inlining.
--   select cron.schedule('budgetly-notif-generate', '0 * * * *', $$
--     select net.http_post(
--       url := 'https://<PROJECT_REF>.functions.supabase.co/generate-notifications',
--       headers := jsonb_build_object('Content-Type', 'application/json',
--                                     'Authorization', 'Bearer <SERVICE_ROLE_KEY>'),
--       body := '{}'::jsonb
--     );
--   $$);
--   -- Daily digest sweep at 13:00 UTC.
--   select cron.schedule('budgetly-notif-digest', '0 13 * * *', $$
--     select net.http_post(
--       url := 'https://<PROJECT_REF>.functions.supabase.co/email-digest',
--       headers := jsonb_build_object('Content-Type', 'application/json',
--                                     'Authorization', 'Bearer <SERVICE_ROLE_KEY>'),
--       body := '{}'::jsonb
--     );
--   $$);
