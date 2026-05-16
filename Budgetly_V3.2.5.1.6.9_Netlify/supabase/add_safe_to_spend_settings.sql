create table if not exists public.safe_to_spend_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month_key text not null,
  allocation numeric not null default 0,
  notes text null,
  rollover_from_last_month numeric not null default 0,
  spent numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, month_key)
);

alter table public.safe_to_spend_settings enable row level security;

create policy if not exists "safe_to_spend_select_own" on public.safe_to_spend_settings for select using (auth.uid() = user_id);
create policy if not exists "safe_to_spend_insert_own" on public.safe_to_spend_settings for insert with check (auth.uid() = user_id);
create policy if not exists "safe_to_spend_update_own" on public.safe_to_spend_settings for update using (auth.uid() = user_id);
create policy if not exists "safe_to_spend_delete_own" on public.safe_to_spend_settings for delete using (auth.uid() = user_id);

create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists safe_to_spend_settings_updated_at on public.safe_to_spend_settings;
create trigger safe_to_spend_settings_updated_at before update on public.safe_to_spend_settings
for each row execute function public.update_updated_at_column();
