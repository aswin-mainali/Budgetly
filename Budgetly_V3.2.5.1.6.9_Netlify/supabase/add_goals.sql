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

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_goals_updated_at on public.goals;
create trigger set_goals_updated_at
before update on public.goals
for each row execute procedure public.set_updated_at();

alter table public.goals enable row level security;

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

create index if not exists idx_goals_user_created on public.goals(user_id, created_at);
