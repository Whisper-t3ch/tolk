-- Слоты на конкретные даты для публичной записи (booking_settings.date_overrides).
-- { "2026-10-28": ["11:00","13:00"], "2026-10-29": [] }: свои времена на дату, пустой массив — день закрыт.
-- Идемпотентно. Выполняется через deploy/ops ДО сборки новой версии, схема сразу перечитывается PostgREST.
alter table public.booking_settings add column if not exists date_overrides jsonb not null default '{}'::jsonb;
notify pgrst, 'reload schema';
select 'date_overrides: ok' as result;
