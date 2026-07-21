-- Net Worth Tracker: assets/liabilities plus daily value snapshots.
-- Mirrors the ownership + RLS conventions used by the investments feature.
-- NOTE: On the primary Budgetly project these tables already exist; this file
-- documents the schema and provisions it for fresh environments.

create table if not exists public.net_worth_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('asset', 'liability')),
  category text not null default 'Other',
  name text not null,
  value numeric not null default 0,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.net_worth_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date_key text not null,                 -- YYYY-MM-DD
  total_assets numeric not null default 0,
  total_liabilities numeric not null default 0,
  net_worth numeric not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, date_key)
);

create index if not exists net_worth_items_user_idx on public.net_worth_items(user_id);
create index if not exists net_worth_snapshots_user_idx on public.net_worth_snapshots(user_id);

alter table public.net_worth_items enable row level security;
alter table public.net_worth_snapshots enable row level security;

create policy if not exists net_worth_items_own on public.net_worth_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy if not exists net_worth_snapshots_own on public.net_worth_snapshots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
