-- Full data backup & restore feature.
-- Adds:
--   * backup_settings        -- per-user automatic-backup toggle + last-run markers
--   * backup_history         -- one row per generated backup (manual / auto / snapshot)
--   * user-backups storage   -- private bucket, owner-scoped, holds the .zip artifacts
--   * restore_user_backup()  -- transactional restore RPC (merge / replace)
--
-- Everything here is additive and idempotent; safe to re-run.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1) Per-user backup settings
-- ---------------------------------------------------------------------------
create table if not exists public.backup_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  auto_backup_enabled boolean not null default false,
  last_manual_backup_at timestamptz,
  last_auto_backup_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_backup_settings_updated_at on public.backup_settings;
create trigger set_backup_settings_updated_at
before update on public.backup_settings
for each row execute procedure public.set_updated_at();

alter table public.backup_settings enable row level security;

drop policy if exists "backup_settings_owner_all" on public.backup_settings;
create policy "backup_settings_owner_all"
on public.backup_settings for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2) Backup history (manifest metadata for every generated backup)
-- ---------------------------------------------------------------------------
create table if not exists public.backup_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'manual' check (kind in ('manual','auto','snapshot')),
  storage_path text,               -- path inside the user-backups bucket, or null if not stored
  record_count integer not null default 0,
  size_bytes bigint not null default 0,
  checksum text,                   -- SHA-256 of the canonical bundle
  app_version text,
  backup_version text,
  manifest jsonb,                  -- full manifest.json (record counts per domain, etc.)
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_backup_history_user_created on public.backup_history(user_id, created_at desc);
create index if not exists idx_backup_history_user_kind on public.backup_history(user_id, kind, created_at desc);

alter table public.backup_history enable row level security;

drop policy if exists "backup_history_owner_select" on public.backup_history;
create policy "backup_history_owner_select"
on public.backup_history for select
using (auth.uid() = user_id);

drop policy if exists "backup_history_owner_delete" on public.backup_history;
create policy "backup_history_owner_delete"
on public.backup_history for delete
using (auth.uid() = user_id);
-- Inserts are performed by the edge functions using the service role, which
-- bypasses RLS; no owner insert policy is required (and withholding it keeps
-- clients from forging history rows).

-- ---------------------------------------------------------------------------
-- 3) Private storage bucket for the backup archives
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-backups',
  'user-backups',
  false,
  104857600, -- 100 MB
  array['application/zip','application/octet-stream']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "user_backups_owner_select" on storage.objects;
create policy "user_backups_owner_select"
on storage.objects for select
using (
  bucket_id = 'user-backups'
  and auth.uid()::text = split_part(name, '/', 1)
);

drop policy if exists "user_backups_owner_insert" on storage.objects;
create policy "user_backups_owner_insert"
on storage.objects for insert
with check (
  bucket_id = 'user-backups'
  and auth.uid()::text = split_part(name, '/', 1)
);

drop policy if exists "user_backups_owner_delete" on storage.objects;
create policy "user_backups_owner_delete"
on storage.objects for delete
using (
  bucket_id = 'user-backups'
  and auth.uid()::text = split_part(name, '/', 1)
);

-- ---------------------------------------------------------------------------
-- 4) Transactional restore
--
-- Runs entirely inside the calling statement's transaction: any error (bad
-- referential integrity, constraint violation, etc.) rolls the whole restore
-- back, so the database is never left half-restored. user_id is forced to the
-- caller on every row, so a backup can only ever write the caller's own data.
--
--   p_mode = 'merge'   -> insert rows that don't already exist (match by key),
--                         leave existing data untouched.
--   p_mode = 'replace' -> delete all of the caller's rows in these domains,
--                         then insert the backup's rows.
-- ---------------------------------------------------------------------------
create or replace function public.restore_user_backup(p jsonb, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Parents first so foreign keys resolve on insert (categories before
  -- transactions, goals before contributions, accounts before holdings, ...).
  v_insert_order text[] := array[
    'categories','goals','investment_accounts','debts',
    'transactions','recurring_items','goal_contributions','investment_holdings',
    'investment_value_snapshots','net_worth_items','net_worth_snapshots',
    'debt_payments','debt_settings','safe_to_spend_settings',
    'notifications','notification_preferences','notification_mutes','user_account_profiles'
  ];
  -- Single-row-per-user domains: dedupe on user_id instead of id.
  v_userid_conflict text[] := array['debt_settings','user_account_profiles','notification_preferences'];
  v_user uuid := auth.uid();
  v_now timestamptz := now();
  v_table text;
  v_rows jsonb;
  v_conflict text;
  v_inserted int;
  v_deleted int;
  v_result jsonb := '{}'::jsonb;
  v_deleted_json jsonb := '{}'::jsonb;
  v_total int := 0;
  i int;
begin
  if v_user is null then
    raise exception 'restore_user_backup: not authenticated';
  end if;
  if p_mode is null or p_mode not in ('merge','replace') then
    raise exception 'restore_user_backup: invalid mode "%"', p_mode;
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'restore_user_backup: payload must be a JSON object';
  end if;

  -- REPLACE: clear existing rows children -> parents (reverse of insert order).
  if p_mode = 'replace' then
    for i in reverse array_length(v_insert_order, 1) .. 1 loop
      v_table := v_insert_order[i];
      execute format('delete from public.%I where user_id = $1', v_table) using v_user;
      get diagnostics v_deleted = row_count;
      v_deleted_json := v_deleted_json || jsonb_build_object(v_table, v_deleted);
    end loop;
  end if;

  -- INSERT parents -> children.
  foreach v_table in array v_insert_order loop
    -- Force user_id onto every row; fill created_at/updated_at defaults when a
    -- row omits them so an incomplete row doesn't NULL out a NOT NULL column
    -- (extra keys are ignored for tables that lack updated_at).
    select coalesce(jsonb_agg(
             jsonb_build_object('created_at', v_now, 'updated_at', v_now)
             || elem
             || jsonb_build_object('user_id', v_user)
           ), '[]'::jsonb)
      into v_rows
    from jsonb_array_elements(
      case when jsonb_typeof(p->v_table) = 'array' then p->v_table else '[]'::jsonb end
    ) elem;

    if v_table = any(v_userid_conflict) then
      v_conflict := 'user_id';
    else
      v_conflict := 'id';
    end if;

    if p_mode = 'merge' then
      execute format(
        'insert into public.%1$I select r.* from jsonb_populate_recordset(null::public.%1$I, $1) r on conflict (%2$s) do nothing',
        v_table, v_conflict
      ) using v_rows;
    else
      execute format(
        'insert into public.%1$I select r.* from jsonb_populate_recordset(null::public.%1$I, $1) r',
        v_table
      ) using v_rows;
    end if;

    get diagnostics v_inserted = row_count;
    v_total := v_total + v_inserted;
    v_result := v_result || jsonb_build_object(v_table, v_inserted);
  end loop;

  return jsonb_build_object(
    'mode', p_mode,
    'inserted_total', v_total,
    'inserted', v_result,
    'deleted', v_deleted_json
  );
exception when others then
  -- Re-raise with the domain that failed so the edge function can surface a
  -- specific message. The transaction is already marked for rollback.
  raise exception 'restore failed on "%": %', coalesce(v_table, 'init'), sqlerrm;
end;
$$;

-- Only signed-in users may call it (it also hard-fails when auth.uid() is null).
revoke execute on function public.restore_user_backup(jsonb, text) from public, anon;
grant execute on function public.restore_user_backup(jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Weekly scheduled automatic backups (pg_cron + pg_net)
--
-- Enabled on the primary project. Runs Sundays 04:00 UTC and calls the
-- auto-backup edge function, which backs up every user who has automatic
-- backups turned on and prunes each to the last 8. Harden by setting a
-- CRON_SECRET function secret and adding it as an 'x-cron-secret' header here.
-- ---------------------------------------------------------------------------
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
-- select cron.schedule('budgetly-weekly-auto-backup', '0 4 * * 0', $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.functions.supabase.co/auto-backup',
--     headers := jsonb_build_object('Content-Type','application/json'),
--     body := '{}'::jsonb
--   );
-- $$);
