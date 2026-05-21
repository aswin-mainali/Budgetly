create table if not exists public.investment_value_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date_key text not null,
  total_value numeric not null default 0,
  total_cost numeric not null default 0,
  gain_loss numeric not null default 0,
  return_percent numeric not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, date_key)
);
alter table public.investment_value_snapshots enable row level security;
drop policy if exists "Users can select own investment snapshots" on public.investment_value_snapshots;
create policy "Users can select own investment snapshots" on public.investment_value_snapshots for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own investment snapshots" on public.investment_value_snapshots;
create policy "Users can insert own investment snapshots" on public.investment_value_snapshots for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own investment snapshots" on public.investment_value_snapshots;
create policy "Users can update own investment snapshots" on public.investment_value_snapshots for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
