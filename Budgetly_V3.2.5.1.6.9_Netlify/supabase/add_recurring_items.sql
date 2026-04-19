alter table if exists public.recurring_items
add column if not exists recurrence_type text not null default 'monthly' check (recurrence_type in ('monthly','weekly','biweekly'));

alter table if exists public.recurring_items
add column if not exists anchor_date date;

update public.recurring_items
set recurrence_type = coalesce(nullif(recurrence_type, ''), 'monthly')
where recurrence_type is null or recurrence_type = '';

update public.recurring_items
set anchor_date = coalesce(anchor_date, current_date)
where anchor_date is null;


alter table if exists public.recurring_items
add column if not exists kind text not null default 'expense'
check (kind in ('expense', 'income'));

update public.recurring_items
set kind = coalesce(nullif(kind, ''), 'expense')
where kind is null or kind = '';
