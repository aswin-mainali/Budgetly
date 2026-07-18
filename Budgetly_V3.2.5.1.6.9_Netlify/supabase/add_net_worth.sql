-- Net Worth tracker: manual asset/liability items + point-in-time snapshots.
-- These tables already exist in the project; this file documents their shape and
-- is safe to re-run (idempotent). Mirrors the per-user RLS used elsewhere.

create table if not exists public.net_worth_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('asset','liability')),
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
  date_key text not null,
  total_assets numeric not null default 0,
  total_liabilities numeric not null default 0,
  net_worth numeric not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.net_worth_items enable row level security;
alter table public.net_worth_snapshots enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'net_worth_items' and policyname = 'net_worth_items_own') then
    create policy net_worth_items_own on public.net_worth_items
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'net_worth_snapshots' and policyname = 'net_worth_snapshots_own') then
    create policy net_worth_snapshots_own on public.net_worth_snapshots
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;
