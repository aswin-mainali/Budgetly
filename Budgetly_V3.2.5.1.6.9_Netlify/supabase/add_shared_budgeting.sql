-- =====================================================================
-- Shared budgeting for couples.
--
-- Adds a gated "Together" space where two Budgetly users pool shared
-- expenses, split them, and keep a running "who owes whom" ledger that
-- reconciles automatically once both accounts are connected.
--
-- The feature rides the existing user_feature_access permission set, so a
-- Super Admin turns it on per user exactly like Investments. Unlike the
-- always-on modules, this one defaults to OFF because it is opt-in.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Feature flag (opt-in: default false)
-- ---------------------------------------------------------------------
alter table public.user_feature_access
  add column if not exists shared_budgeting boolean not null default false;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

-- A shared space is the container both partners post into. Couples have one,
-- but the model allows a person to belong to several (e.g. partner + a roommate).
create table if not exists public.shared_spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'CAD',
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Membership. default_split is the percentage share this member is responsible
-- for by default (couples usually 50/50). role is 'owner' (creator) or 'member'.
create table if not exists public.shared_space_members (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.shared_spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  default_split numeric not null default 50 check (default_split >= 0 and default_split <= 100),
  joined_at timestamptz not null default now(),
  unique (space_id, user_id)
);

-- Pending invitations, addressed by email so we can invite someone who has not
-- connected yet. The recipient sees invites matched to their own auth email.
create table if not exists public.shared_space_invites (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.shared_spaces(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  invitee_email text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

-- A shared expense. paid_by fronted the money; payer_share is the percentage of
-- the total the payer is responsible for (the rest is owed to them by the other
-- member). split_type is metadata describing how payer_share was chosen.
create table if not exists public.shared_expenses (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.shared_spaces(id) on delete cascade,
  paid_by uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  amount numeric not null check (amount > 0),
  note text,
  emoji text,
  date date not null default (now() at time zone 'utc')::date,
  split_type text not null default 'equal'
    check (split_type in ('equal', 'percent', 'payer_full', 'other_full')),
  payer_share numeric not null default 50 check (payer_share >= 0 and payer_share <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A settlement (repayment) that pays down the running balance between two members.
create table if not exists public.shared_settlements (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.shared_spaces(id) on delete cascade,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  amount numeric not null check (amount > 0),
  note text,
  date date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. updated_at triggers (reuse public.set_updated_at from add_goals.sql)
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_shared_spaces_updated_at on public.shared_spaces;
create trigger set_shared_spaces_updated_at
before update on public.shared_spaces
for each row execute procedure public.set_updated_at();

drop trigger if exists set_shared_expenses_updated_at on public.shared_expenses;
create trigger set_shared_expenses_updated_at
before update on public.shared_expenses
for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------
-- 3. Membership helper (SECURITY DEFINER so membership policies never recurse)
-- ---------------------------------------------------------------------
create or replace function public.is_shared_member(p_space_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.shared_space_members m
    where m.space_id = p_space_id and m.user_id = p_user_id
  );
$$;

revoke all on function public.is_shared_member(uuid, uuid) from public;
grant execute on function public.is_shared_member(uuid, uuid) to authenticated;

-- Lower-cased auth email of the current caller, for matching invites.
create or replace function public.current_auth_email()
returns text
language sql
stable
as $$
  select lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''));
$$;

-- ---------------------------------------------------------------------
-- 4. Row level security
-- ---------------------------------------------------------------------
alter table public.shared_spaces          enable row level security;
alter table public.shared_space_members   enable row level security;
alter table public.shared_space_invites   enable row level security;
alter table public.shared_expenses        enable row level security;
alter table public.shared_settlements     enable row level security;

-- shared_spaces: members can read; creator inserts; owners update/delete.
drop policy if exists "spaces_member_select" on public.shared_spaces;
create policy "spaces_member_select"
on public.shared_spaces for select
using (public.is_shared_member(id, auth.uid()));

drop policy if exists "spaces_owner_insert" on public.shared_spaces;
create policy "spaces_owner_insert"
on public.shared_spaces for insert
with check (auth.uid() = created_by);

drop policy if exists "spaces_owner_update" on public.shared_spaces;
create policy "spaces_owner_update"
on public.shared_spaces for update
using (public.is_shared_member(id, auth.uid()))
with check (public.is_shared_member(id, auth.uid()));

drop policy if exists "spaces_creator_delete" on public.shared_spaces;
create policy "spaces_creator_delete"
on public.shared_spaces for delete
using (auth.uid() = created_by);

-- shared_space_members: a member can see the roster of any space they belong to,
-- and always their own row. Inserts/updates are done through SECURITY DEFINER
-- RPCs (create/accept/leave), so there is intentionally no client INSERT policy.
drop policy if exists "members_select" on public.shared_space_members;
create policy "members_select"
on public.shared_space_members for select
using (user_id = auth.uid() or public.is_shared_member(space_id, auth.uid()));

drop policy if exists "members_self_delete" on public.shared_space_members;
create policy "members_self_delete"
on public.shared_space_members for delete
using (user_id = auth.uid());

-- shared_space_invites: the invitee (matched by email) and space members can read.
-- A member can create an invite for their space; the invitee can update status.
drop policy if exists "invites_select" on public.shared_space_invites;
create policy "invites_select"
on public.shared_space_invites for select
using (
  lower(invitee_email) = public.current_auth_email()
  or public.is_shared_member(space_id, auth.uid())
);

drop policy if exists "invites_member_insert" on public.shared_space_invites;
create policy "invites_member_insert"
on public.shared_space_invites for insert
with check (
  auth.uid() = invited_by
  and public.is_shared_member(space_id, auth.uid())
);

drop policy if exists "invites_member_delete" on public.shared_space_invites;
create policy "invites_member_delete"
on public.shared_space_invites for delete
using (public.is_shared_member(space_id, auth.uid()));

-- shared_expenses: full CRUD for members of the space.
drop policy if exists "expenses_member_select" on public.shared_expenses;
create policy "expenses_member_select"
on public.shared_expenses for select
using (public.is_shared_member(space_id, auth.uid()));

drop policy if exists "expenses_member_insert" on public.shared_expenses;
create policy "expenses_member_insert"
on public.shared_expenses for insert
with check (
  auth.uid() = created_by
  and public.is_shared_member(space_id, auth.uid())
);

drop policy if exists "expenses_member_update" on public.shared_expenses;
create policy "expenses_member_update"
on public.shared_expenses for update
using (public.is_shared_member(space_id, auth.uid()))
with check (public.is_shared_member(space_id, auth.uid()));

drop policy if exists "expenses_member_delete" on public.shared_expenses;
create policy "expenses_member_delete"
on public.shared_expenses for delete
using (public.is_shared_member(space_id, auth.uid()));

-- shared_settlements: members can read/insert/delete settlements in their space.
drop policy if exists "settlements_member_select" on public.shared_settlements;
create policy "settlements_member_select"
on public.shared_settlements for select
using (public.is_shared_member(space_id, auth.uid()));

drop policy if exists "settlements_member_insert" on public.shared_settlements;
create policy "settlements_member_insert"
on public.shared_settlements for insert
with check (
  (auth.uid() = from_user or auth.uid() = to_user)
  and public.is_shared_member(space_id, auth.uid())
);

drop policy if exists "settlements_member_delete" on public.shared_settlements;
create policy "settlements_member_delete"
on public.shared_settlements for delete
using (public.is_shared_member(space_id, auth.uid()));

-- ---------------------------------------------------------------------
-- 5. RPCs for the operations that must cross RLS boundaries
-- ---------------------------------------------------------------------

-- Guard: does this user have the shared_budgeting feature enabled?
create or replace function public.has_shared_budgeting(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select shared_budgeting from public.user_feature_access where user_id = p_user_id),
    false
  );
$$;

-- Create a space, enroll the creator as owner, and optionally invite a partner
-- by email. Returns the new space id.
create or replace function public.create_shared_space(
  p_name text,
  p_currency text default 'CAD',
  p_invitee_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_space_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_shared_budgeting(v_uid) then
    raise exception 'Shared budgeting is not enabled for this account';
  end if;

  insert into public.shared_spaces (name, currency, created_by)
  values (coalesce(nullif(trim(p_name), ''), 'Our Household'), coalesce(p_currency, 'CAD'), v_uid)
  returning id into v_space_id;

  insert into public.shared_space_members (space_id, user_id, role, default_split)
  values (v_space_id, v_uid, 'owner', 50);

  if p_invitee_email is not null and trim(p_invitee_email) <> '' then
    insert into public.shared_space_invites (space_id, invited_by, invitee_email)
    values (v_space_id, v_uid, lower(trim(p_invitee_email)));
  end if;

  return v_space_id;
end;
$$;

-- Send (or re-send) an invite to a partner for an existing space.
create or replace function public.invite_to_shared_space(
  p_space_id uuid,
  p_invitee_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invite_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_shared_member(p_space_id, v_uid) then
    raise exception 'Only members can invite to this space';
  end if;
  if trim(coalesce(p_invitee_email, '')) = '' then
    raise exception 'An email is required';
  end if;

  insert into public.shared_space_invites (space_id, invited_by, invitee_email)
  values (p_space_id, v_uid, lower(trim(p_invitee_email)))
  returning id into v_invite_id;

  return v_invite_id;
end;
$$;

-- Accept an invite addressed to the caller's email: join the space and mark it
-- accepted. Returns the joined space id.
create or replace function public.accept_shared_invite(p_invite_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := public.current_auth_email();
  v_invite public.shared_space_invites;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_shared_budgeting(v_uid) then
    raise exception 'Shared budgeting is not enabled for this account';
  end if;

  select * into v_invite from public.shared_space_invites where id = p_invite_id;
  if not found then
    raise exception 'Invite not found';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'This invite has already been handled';
  end if;
  if lower(v_invite.invitee_email) <> v_email then
    raise exception 'This invite was not addressed to you';
  end if;

  insert into public.shared_space_members (space_id, user_id, role, default_split)
  values (v_invite.space_id, v_uid, 'member', 50)
  on conflict (space_id, user_id) do nothing;

  update public.shared_space_invites
    set status = 'accepted', responded_at = now()
    where id = p_invite_id;

  return v_invite.space_id;
end;
$$;

-- Decline an invite addressed to the caller's email.
create or replace function public.decline_shared_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.current_auth_email();
  v_invite public.shared_space_invites;
begin
  select * into v_invite from public.shared_space_invites where id = p_invite_id;
  if not found then
    return;
  end if;
  if lower(v_invite.invitee_email) <> v_email then
    raise exception 'This invite was not addressed to you';
  end if;

  update public.shared_space_invites
    set status = 'declined', responded_at = now()
    where id = p_invite_id;
end;
$$;

-- Leave a space. If the last member leaves, the space (and its rows) is removed
-- via the on delete cascade.
create or replace function public.leave_shared_space(p_space_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_remaining int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.shared_space_members
    where space_id = p_space_id and user_id = v_uid;

  select count(*) into v_remaining
    from public.shared_space_members where space_id = p_space_id;

  if v_remaining = 0 then
    delete from public.shared_spaces where id = p_space_id;
  end if;
end;
$$;

revoke all on function public.create_shared_space(text, text, text) from public;
revoke all on function public.invite_to_shared_space(uuid, text) from public;
revoke all on function public.accept_shared_invite(uuid) from public;
revoke all on function public.decline_shared_invite(uuid) from public;
revoke all on function public.leave_shared_space(uuid) from public;
grant execute on function public.create_shared_space(text, text, text) to authenticated;
grant execute on function public.invite_to_shared_space(uuid, text) to authenticated;
grant execute on function public.accept_shared_invite(uuid) to authenticated;
grant execute on function public.decline_shared_invite(uuid) to authenticated;
grant execute on function public.leave_shared_space(uuid) to authenticated;

-- Expose members' display info (email) to co-members so the UI can label rows.
-- A member may look up the email of anyone who shares a space with them.
create or replace function public.shared_space_member_emails(p_space_id uuid)
returns table (user_id uuid, email text)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_shared_member(p_space_id, auth.uid()) then
    raise exception 'Not a member of this space';
  end if;
  return query
    select u.id, u.email::text
    from auth.users u
    join public.shared_space_members m on m.user_id = u.id
    where m.space_id = p_space_id;
end;
$$;

revoke all on function public.shared_space_member_emails(uuid) from public;
grant execute on function public.shared_space_member_emails(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Indexes
-- ---------------------------------------------------------------------
create index if not exists idx_shared_members_user on public.shared_space_members(user_id);
create index if not exists idx_shared_members_space on public.shared_space_members(space_id);
create index if not exists idx_shared_invites_email on public.shared_space_invites(lower(invitee_email));
create index if not exists idx_shared_invites_space on public.shared_space_invites(space_id);
create index if not exists idx_shared_expenses_space on public.shared_expenses(space_id, date desc);
create index if not exists idx_shared_settlements_space on public.shared_settlements(space_id, date desc);

-- ---------------------------------------------------------------------
-- 7. Realtime
-- ---------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.shared_expenses;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.shared_settlements;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.shared_space_members;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.shared_space_invites;
  exception when duplicate_object then null; end;
end $$;
