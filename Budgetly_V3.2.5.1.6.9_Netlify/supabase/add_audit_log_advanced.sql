-- ============================================================================
-- Budgetly — Advanced audit log.
-- Makes Settings > Audit Log more detailed, accurate and tamper-resistant:
--   1. Richer columns: category, before/after snapshots, actor/target email,
--      IP address and user-agent.
--   2. Server-side trigger logging so every super-admin change to profiles,
--      feature access and bug reports is recorded automatically with an exact
--      before -> after diff — the client can no longer forget to log, or forge
--      an entry it didn't perform.
--   3. An RPC (log_admin_action) for events that aren't a table change
--      (e.g. a password-reset email).
-- Safe to run multiple times (idempotent).
-- ============================================================================

-- 1) New columns ----------------------------------------------------------------
alter table public.admin_audit_logs
  add column if not exists category text,
  add column if not exists "before" jsonb,
  add column if not exists "after" jsonb,
  add column if not exists actor_email text,
  add column if not exists target_email text,
  add column if not exists ip_address text,
  add column if not exists user_agent text;

-- 2) Helper: best-effort request context (PostgREST exposes request headers) -----
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
  -- x-forwarded-for may be a comma-separated list; keep the original client.
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

-- 3) Trigger function: record super-admin changes with an exact diff ------------
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
  -- Only super-admin actions are audited. Self-service writes and the signup
  -- trigger run as the affected user (or a definer function), so is_super_admin()
  -- is false for them and they are skipped.
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
    -- last_active_at is stamped on every page load; never treat it as an edit.
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
    -- Skip large/noisy payloads that would bloat the log.
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
    -- Nothing meaningful changed (e.g. only updated_at moved) — don't log noise.
    if v_before = '{}'::jsonb then
      return new;
    end if;
  elsif tg_op = 'DELETE' then
    -- Snapshot the identifying fields so a removed user is still readable later.
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
    -- `details` keeps the changed "after" values for backward-compatible readers.
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

-- 4) RPC for non-table events (password-reset emails, etc.) ---------------------
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

-- 5) Indexes for filtering ------------------------------------------------------
create index if not exists idx_admin_audit_logs_created on public.admin_audit_logs(created_at desc);
create index if not exists idx_admin_audit_logs_action on public.admin_audit_logs(action);
create index if not exists idx_admin_audit_logs_category on public.admin_audit_logs(category);
create index if not exists idx_admin_audit_logs_admin on public.admin_audit_logs(admin_user_id);
create index if not exists idx_admin_audit_logs_target on public.admin_audit_logs(target_user_id);
