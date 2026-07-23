-- Document Vault (Utilities): a PIN-protected store for important documents
-- (agreements, insurance policies, contracts, warranties, …) with AI-detected
-- agreement / expiration dates and expiry reminders.
--
-- Mirrors the ownership + RLS conventions used by the Net Worth and profile
-- image features. Files live in a PRIVATE storage bucket ('document-vault');
-- the app reads them through short-lived signed URLs.
--
-- Run this migration against your Supabase project, then reload the app.

-- ── Files ───────────────────────────────────────────────────────────────────
create table if not exists public.document_vault_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '',
  doc_type text not null default 'other'
    check (doc_type in ('agreement', 'insurance', 'contract', 'warranty', 'lease', 'license', 'certificate', 'other')),
  issuer text,
  reference_number text,
  agreement_date date,
  expiration_date date,
  notes text,
  -- Original file, stored privately in the 'document-vault' bucket.
  storage_path text not null,
  file_name text not null default '',
  mime_type text,
  file_size bigint,
  -- AI extraction bookkeeping.
  ai_extracted boolean not null default false,
  ai_confidence numeric,
  ai_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_vault_files_user_idx on public.document_vault_files(user_id);
create index if not exists document_vault_files_expiry_idx on public.document_vault_files(user_id, expiration_date);

alter table public.document_vault_files enable row level security;

drop policy if exists document_vault_files_own on public.document_vault_files;
create policy document_vault_files_own on public.document_vault_files
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Security (per-user vault PIN + reset) ────────────────────────────────────
-- The PIN is hashed on the client (SHA-256 over salt + pin) so the raw PIN
-- never touches the server. reset_code_hash / reset_expires_at are written by
-- the 'document-vault-pin-reset' edge function (service role) and verified
-- there — the client never needs to read them.
create table if not exists public.document_vault_security (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  pin_hash text,
  pin_salt text,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  reset_code_hash text,
  reset_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.document_vault_security enable row level security;

drop policy if exists document_vault_security_own on public.document_vault_security;
create policy document_vault_security_own on public.document_vault_security
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Keep updated_at fresh (reuses the shared trigger fn from schema.sql).
drop trigger if exists set_document_vault_files_updated_at on public.document_vault_files;
create trigger set_document_vault_files_updated_at
before update on public.document_vault_files
for each row execute procedure public.set_updated_at();

drop trigger if exists set_document_vault_security_updated_at on public.document_vault_security;
create trigger set_document_vault_security_updated_at
before update on public.document_vault_security
for each row execute procedure public.set_updated_at();

-- ── Notification preference toggle ───────────────────────────────────────────
-- Lets users mute document-expiry reminders alongside the other categories.
-- Safe no-op if the notifications feature isn't provisioned yet.
alter table if exists public.notification_preferences
  add column if not exists documents boolean not null default true;

-- ── Private storage bucket ───────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'document-vault',
  'document-vault',
  false,
  26214400, -- 25 MB
  array[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Owner-scoped object access: files are namespaced under "<user_id>/…".
drop policy if exists "document_vault_owner_select" on storage.objects;
create policy "document_vault_owner_select"
on storage.objects for select
using (
  bucket_id = 'document-vault'
  and auth.uid()::text = split_part(name, '/', 1)
);

drop policy if exists "document_vault_owner_insert" on storage.objects;
create policy "document_vault_owner_insert"
on storage.objects for insert
with check (
  bucket_id = 'document-vault'
  and auth.uid()::text = split_part(name, '/', 1)
);

drop policy if exists "document_vault_owner_update" on storage.objects;
create policy "document_vault_owner_update"
on storage.objects for update
using (
  bucket_id = 'document-vault'
  and auth.uid()::text = split_part(name, '/', 1)
)
with check (
  bucket_id = 'document-vault'
  and auth.uid()::text = split_part(name, '/', 1)
);

drop policy if exists "document_vault_owner_delete" on storage.objects;
create policy "document_vault_owner_delete"
on storage.objects for delete
using (
  bucket_id = 'document-vault'
  and auth.uid()::text = split_part(name, '/', 1)
);
