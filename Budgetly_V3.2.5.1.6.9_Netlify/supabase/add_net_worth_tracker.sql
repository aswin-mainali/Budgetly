create table if not exists public.net_worth_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null,
  amount numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.net_worth_debts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, type text not null, balance numeric not null default 0, interest_rate numeric not null default 0,
  minimum_payment numeric not null default 0, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.net_worth_snapshots (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  month_key text not null, total_assets numeric not null default 0, total_debts numeric not null default 0, net_worth numeric not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id, month_key)
);
alter table public.net_worth_assets enable row level security;
alter table public.net_worth_debts enable row level security;
alter table public.net_worth_snapshots enable row level security;
create policy if not exists "assets own rows" on public.net_worth_assets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy if not exists "debts own rows" on public.net_worth_debts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy if not exists "snapshots own rows" on public.net_worth_snapshots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
