-- AI Receipt Capture: store a captured receipt image alongside a transaction.
-- The image is kept as a compressed JPEG data URL in a single text column so the
-- feature needs no storage bucket or extra policies (mirrors how bug_reports keeps
-- screenshot_data_url). Client-side compression keeps these small before they land here.
alter table public.transactions
  add column if not exists receipt_url text;

comment on column public.transactions.receipt_url is
  'Optional captured receipt image as a compressed JPEG data URL (AI receipt capture).';
