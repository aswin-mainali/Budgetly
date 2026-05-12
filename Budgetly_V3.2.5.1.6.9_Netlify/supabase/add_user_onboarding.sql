create table if not exists public.user_onboarding (
  user_id uuid primary key references auth.users(id) on delete cascade,
  has_seen_welcome_tour boolean not null default false,
  welcome_tour_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_onboarding enable row level security;

create policy "user_onboarding_select_own" on public.user_onboarding
for select using (auth.uid() = user_id);

create policy "user_onboarding_insert_own" on public.user_onboarding
for insert with check (auth.uid() = user_id);

create policy "user_onboarding_update_own" on public.user_onboarding
for update using (auth.uid() = user_id);
