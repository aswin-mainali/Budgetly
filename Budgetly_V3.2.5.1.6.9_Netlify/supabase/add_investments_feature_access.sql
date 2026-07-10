-- Add the Investments module to the feature-access permission set.
-- Backward compatible: existing users keep Investments enabled (default true),
-- matching the previous always-on behavior.
alter table public.user_feature_access
  add column if not exists investments boolean not null default true;
