-- Track whether a user has completed (or dismissed) the first sign-in walkthrough.
-- Persisted per user so the tour only shows once across every device/browser.

alter table public.user_account_profiles
  add column if not exists walkthrough_completed_at timestamptz;
