create table if not exists public.investment_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  type text not null,
  provider text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists public.investment_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid references public.investment_accounts(id) on delete set null,
  symbol text not null, company_name text not null, exchange text,
  quantity numeric not null default 0, average_cost numeric not null default 0,
  current_price numeric not null default 0, previous_close numeric default 0,
  currency text default 'CAD', logo_url text, notes text,
  last_price_updated_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists public.investment_value_snapshots (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date_key text not null, total_value numeric not null default 0, total_cost numeric not null default 0,
  gain_loss numeric not null default 0, return_percent numeric not null default 0,
  created_at timestamptz default now(), updated_at timestamptz default now(), unique(user_id,date_key)
);
alter table public.investment_accounts enable row level security;
alter table public.investment_holdings enable row level security;
alter table public.investment_value_snapshots enable row level security;
create policy if not exists investment_accounts_own on public.investment_accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy if not exists investment_holdings_own on public.investment_holdings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy if not exists investment_snapshots_own on public.investment_value_snapshots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
