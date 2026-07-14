-- Advanced bug report enhancements.
-- Builds on add_bug_reports.sql. Everything here is idempotent and safe to re-run.
--
--   * Richer report fields: title, category, user-perceived severity, and a
--     diagnostics blob (browser / OS / screen / app version / page).
--   * A human-friendly reference code (BUG-00001) so users can quote their report.
--   * A dedicated workflow_status column so users can track progress WITHOUT us
--     exposing the internal admin_notes field.
--   * A status timeline (bug_report_events) the reporter can read.
--   * A trigger that records every status change and drops an in-app notification
--     to the reporter, so "you'll know the status of your bug" works out of the box.

create extension if not exists "pgcrypto";

-- 1) New columns on bug_reports ------------------------------------------------
create sequence if not exists public.bug_reports_ref_seq;

alter table public.bug_reports add column if not exists title text not null default '';
alter table public.bug_reports add column if not exists category text not null default 'other';
alter table public.bug_reports add column if not exists user_severity text not null default 'medium'
  check (user_severity in ('low', 'medium', 'high', 'critical'));
alter table public.bug_reports add column if not exists workflow_status text not null default 'pending'
  check (workflow_status in ('pending', 'in_progress', 'in_review', 'resolved'));
alter table public.bug_reports add column if not exists diagnostics jsonb;
alter table public.bug_reports add column if not exists reference_code text;

-- Backfill reference codes for any existing rows, then make it the default.
update public.bug_reports
  set reference_code = 'BUG-' || lpad(nextval('public.bug_reports_ref_seq')::text, 5, '0')
  where reference_code is null;

alter table public.bug_reports
  alter column reference_code
  set default 'BUG-' || lpad(nextval('public.bug_reports_ref_seq')::text, 5, '0');

create unique index if not exists idx_bug_reports_reference_code
  on public.bug_reports(reference_code);

-- Bring legacy rows (only pending/completed) in line with the workflow column.
update public.bug_reports
  set workflow_status = 'resolved'
  where status = 'completed' and workflow_status = 'pending';

-- 2) Status timeline -----------------------------------------------------------
create table if not exists public.bug_report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.bug_reports(id) on delete cascade,
  status text not null,
  note text,                                              -- optional public message to the reporter
  actor text not null default 'system' check (actor in ('user', 'admin', 'system')),
  created_at timestamptz not null default now()
);
create index if not exists idx_bug_report_events_report
  on public.bug_report_events(report_id, created_at);

alter table public.bug_report_events enable row level security;

-- The reporter can read their own timeline; super admins can read any.
drop policy if exists "bug_report_events_owner_select" on public.bug_report_events;
create policy "bug_report_events_owner_select"
on public.bug_report_events for select
using (
  public.is_super_admin()
  or exists (
    select 1 from public.bug_reports r
    where r.id = report_id and r.user_id = auth.uid()
  )
);

-- Only super admins can add public messages manually (the trigger runs as definer).
drop policy if exists "bug_report_events_admin_insert" on public.bug_report_events;
create policy "bug_report_events_admin_insert"
on public.bug_report_events for insert
with check (public.is_super_admin());

-- 3) Trigger: log status changes + notify the reporter -------------------------
create or replace function public.handle_bug_report_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  status_phrase text;
  report_label text;
begin
  if (tg_op = 'INSERT') then
    insert into public.bug_report_events (report_id, status, actor)
    values (new.id, 'submitted', 'user');
    return new;
  end if;

  -- Only act when the workflow status actually changes.
  if (new.workflow_status is distinct from old.workflow_status) then
    insert into public.bug_report_events (report_id, status, actor)
    values (new.id, new.workflow_status, 'admin');

    report_label := left(coalesce(nullif(new.title, ''), new.steps_to_reproduce), 60);
    status_phrase := case new.workflow_status
      when 'in_progress' then 'is now being worked on'
      when 'in_review'   then 'is in review'
      when 'resolved'    then 'has been resolved'
      else 'was updated'
    end;

    insert into public.notifications
      (user_id, category, section, title, message, type, priority, metadata)
    values (
      new.user_id,
      'system_updates',
      'system',
      'Bug ' || coalesce(new.reference_code, '') || ' ' ||
        case new.workflow_status when 'resolved' then 'resolved' else 'updated' end,
      'Your report "' || report_label || '" ' || status_phrase || '.',
      'bug_status',
      case when new.workflow_status = 'resolved' then 'high' else 'normal' end,
      jsonb_build_object(
        'report_id', new.id,
        'reference_code', new.reference_code,
        'workflow_status', new.workflow_status,
        'dedupe_key', 'bug:' || new.id || ':' || new.workflow_status
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_bug_report_insert on public.bug_reports;
create trigger on_bug_report_insert
after insert on public.bug_reports
for each row execute procedure public.handle_bug_report_change();

drop trigger if exists on_bug_report_status_change on public.bug_reports;
create trigger on_bug_report_status_change
after update on public.bug_reports
for each row execute procedure public.handle_bug_report_change();
