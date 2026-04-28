-- Add dedicated account profile table + profile image storage policies.

create table if not exists public.user_account_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_user_account_profiles_updated_at on public.user_account_profiles;
create trigger set_user_account_profiles_updated_at
before update on public.user_account_profiles
for each row execute procedure public.set_updated_at();

alter table public.user_account_profiles enable row level security;

drop policy if exists "user_account_profiles_self_select" on public.user_account_profiles;
create policy "user_account_profiles_self_select"
on public.user_account_profiles for select
using (auth.uid() = user_id or public.is_super_admin());

drop policy if exists "user_account_profiles_self_insert" on public.user_account_profiles;
create policy "user_account_profiles_self_insert"
on public.user_account_profiles for insert
with check (auth.uid() = user_id);

drop policy if exists "user_account_profiles_self_update" on public.user_account_profiles;
create policy "user_account_profiles_self_update"
on public.user_account_profiles for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "user_account_profiles_self_delete" on public.user_account_profiles;
create policy "user_account_profiles_self_delete"
on public.user_account_profiles for delete
using (auth.uid() = user_id);

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'profile-images') then
    perform storage.create_bucket(
      'profile-images',
      public := true,
      file_size_limit := 5242880,
      allowed_mime_types := array['image/png', 'image/jpeg', 'image/webp']
    );
  end if;
end $$;

update storage.buckets
set public = true,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
where id = 'profile-images';

drop policy if exists "profile_images_owner_select" on storage.objects;
create policy "profile_images_owner_select"
on storage.objects for select
using (
  bucket_id = 'profile-images'
  and auth.uid()::text = split_part(name, '/', 1)
);

drop policy if exists "profile_images_owner_insert" on storage.objects;
create policy "profile_images_owner_insert"
on storage.objects for insert
with check (
  bucket_id = 'profile-images'
  and auth.uid()::text = split_part(name, '/', 1)
);

drop policy if exists "profile_images_owner_update" on storage.objects;
create policy "profile_images_owner_update"
on storage.objects for update
using (
  bucket_id = 'profile-images'
  and auth.uid()::text = split_part(name, '/', 1)
)
with check (
  bucket_id = 'profile-images'
  and auth.uid()::text = split_part(name, '/', 1)
);

drop policy if exists "profile_images_owner_delete" on storage.objects;
create policy "profile_images_owner_delete"
on storage.objects for delete
using (
  bucket_id = 'profile-images'
  and auth.uid()::text = split_part(name, '/', 1)
);

create index if not exists idx_user_account_profiles_updated on public.user_account_profiles(updated_at desc);
