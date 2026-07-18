-- Add the Net Worth module to the feature-access permission set.
-- Backward compatible: existing users keep Net Worth enabled (default true).
alter table public.user_feature_access
  add column if not exists networth boolean not null default true;
