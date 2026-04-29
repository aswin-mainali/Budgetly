create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null,
  lender text not null default '',
  original_balance numeric(12,2) not null default 0,
  current_balance numeric(12,2) not null default 0,
  interest_rate numeric(6,3) not null default 0,
  minimum_payment numeric(12,2) not null default 0,
  payment_frequency text not null default 'monthly',
  due_day_or_date text,
  note text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.debt_payments (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.debts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(12,2) not null,
  payment_date date not null,
  source_type text not null default 'manual',
  linked_transaction_id uuid,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.debt_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  strategy_type text not null default 'avalanche',
  extra_monthly_payment numeric(12,2) not null default 0,
  custom_order jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
