create table if not exists public.user_passkeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  device_name text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.user_passkeys enable row level security;

create policy "Users can read own passkeys"
  on public.user_passkeys for select
  using (auth.uid() = user_id);

create policy "Users can insert own passkeys"
  on public.user_passkeys for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own passkeys"
  on public.user_passkeys for delete
  using (auth.uid() = user_id);

create policy "Users can update own passkeys"
  on public.user_passkeys for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
