alter table if exists public.categories
add column if not exists emoji text;

update public.categories
set emoji = coalesce(nullif(emoji, ''), '🏷️')
where emoji is null or emoji = '';
