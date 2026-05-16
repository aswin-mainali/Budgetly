create table if not exists public.safe_to_spend_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month_key text not null,
  allocation numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, month_key)
);

alter table public.safe_to_spend_settings enable row level security;

drop policy if exists "Users can read own safe to spend settings" on public.safe_to_spend_settings;
create policy "Users can read own safe to spend settings"
on public.safe_to_spend_settings
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own safe to spend settings" on public.safe_to_spend_settings;
create policy "Users can insert own safe to spend settings"
on public.safe_to_spend_settings
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own safe to spend settings" on public.safe_to_spend_settings;
create policy "Users can update own safe to spend settings"
on public.safe_to_spend_settings
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own safe to spend settings" on public.safe_to_spend_settings;
create policy "Users can delete own safe to spend settings"
on public.safe_to_spend_settings
for delete
using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_safe_to_spend_settings_updated_at on public.safe_to_spend_settings;
create trigger set_safe_to_spend_settings_updated_at
before update on public.safe_to_spend_settings
for each row
execute function public.set_updated_at();
