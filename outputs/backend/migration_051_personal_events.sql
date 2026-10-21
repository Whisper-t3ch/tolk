-- 051: личные (бытовые) события психолога в календаре: тренировка, обед, врач…
-- Раньше хранились только в localStorage браузера — ассистент их не видел и не мог создавать.
-- Время локальное (в поясе психолога), как и в интерфейсе: event_date + start_time (HH:MM).

create table if not exists public.personal_events (
  id               uuid primary key default gen_random_uuid(),
  psychologist_id  uuid not null default auth.uid(),
  event_date       date not null,
  start_time       text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  duration_minutes integer not null default 60 check (duration_minutes between 5 and 1440),
  title            text not null check (char_length(title) between 1 and 200),
  created_at       timestamptz not null default now()
);

create index if not exists personal_events_psy_date_idx
  on public.personal_events (psychologist_id, event_date);

alter table public.personal_events enable row level security;

drop policy if exists personal_events_select_own on public.personal_events;
drop policy if exists personal_events_insert_own on public.personal_events;
drop policy if exists personal_events_update_own on public.personal_events;
drop policy if exists personal_events_delete_own on public.personal_events;

create policy personal_events_select_own on public.personal_events
  for select using (psychologist_id = auth.uid());
create policy personal_events_insert_own on public.personal_events
  for insert with check (psychologist_id = auth.uid());
create policy personal_events_update_own on public.personal_events
  for update using (psychologist_id = auth.uid()) with check (psychologist_id = auth.uid());
create policy personal_events_delete_own on public.personal_events
  for delete using (psychologist_id = auth.uid());

grant select, insert, update, delete on public.personal_events to authenticated;

notify pgrst, 'reload schema';
