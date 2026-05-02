create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  merchant text,
  receipt_date date,
  amount numeric(12,2),
  category text,
  notes text,
  type text not null default 'expense' check (type = 'expense'),
  status text not null default 'needs_review' check (status in ('needs_review','ready_to_add','added','failed','archived')),
  ocr_confidence numeric(5,2),
  raw_ocr_text text,
  transaction_id uuid references public.transactions(id) on delete set null,
  scan_error text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.receipts enable row level security;
create policy if not exists "Users can manage own receipts" on public.receipts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
insert into storage.buckets (id, name, public) values ('receipt-images', 'receipt-images', false) on conflict (id) do nothing;
