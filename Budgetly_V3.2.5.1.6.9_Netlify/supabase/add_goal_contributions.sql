-- Per-goal contribution history so we can compute contribution pace,
-- projected completion dates, and cumulative-saved sparklines.
-- Each deposit made via contributeToGoal / "Add funds" logs one row here;
-- goals.current_amount stays as the cached running total.

create table if not exists public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric not null,
  created_at timestamptz not null default now()
);

alter table public.goal_contributions enable row level security;

drop policy if exists "goal_contributions_owner_select" on public.goal_contributions;
create policy "goal_contributions_owner_select"
on public.goal_contributions for select
using (auth.uid() = user_id);

drop policy if exists "goal_contributions_owner_insert" on public.goal_contributions;
create policy "goal_contributions_owner_insert"
on public.goal_contributions for insert
with check (auth.uid() = user_id);

drop policy if exists "goal_contributions_owner_update" on public.goal_contributions;
create policy "goal_contributions_owner_update"
on public.goal_contributions for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "goal_contributions_owner_delete" on public.goal_contributions;
create policy "goal_contributions_owner_delete"
on public.goal_contributions for delete
using (auth.uid() = user_id);

create index if not exists idx_goal_contributions_goal on public.goal_contributions(goal_id, created_at);
create index if not exists idx_goal_contributions_user on public.goal_contributions(user_id, created_at);

-- Backfill existing goals: seed one contribution at the goal's creation date
-- equal to the current running total, so historical goals show a real starting
-- point (2-point sparkline / a pace baseline) instead of "No contributions yet".
insert into public.goal_contributions (goal_id, user_id, amount, created_at)
select g.id, g.user_id, g.current_amount, g.created_at
from public.goals g
where g.current_amount > 0
  and not exists (
    select 1 from public.goal_contributions c where c.goal_id = g.id
  );
