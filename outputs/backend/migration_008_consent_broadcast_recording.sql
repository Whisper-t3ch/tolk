-- ============================================================
-- migration_008_consent_broadcast_recording.sql
--
-- Три независимых изменения схемы по итогам сверки обещаний психологам
-- с реальной реализацией (2026-09-03):
--
-- 1. Согласие психолога с офертой/ПД при регистрации (psychologists).
-- 2. Согласие клиента на обработку ПД при публичном бронировании (sessions).
-- 3. 'broadcast' как допустимое значение messages.kind (15-й инструмент
--    ассистента, send_broadcast_message) + 'stopped_by_client' как
--    допустимое значение sessions.recording_status (кнопка остановки
--    записи клиентом в UI звонка).
--
-- Применять через Supabase SQL Editor. Все операции идемпотентны —
-- безопасно применять повторно.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Согласие психолога с офертой (см. src/app/api/onboarding/accept-terms)
-- ------------------------------------------------------------
alter table psychologists
  add column if not exists terms_accepted_at timestamptz;

alter table psychologists
  add column if not exists terms_version text default 'v1';

-- ------------------------------------------------------------
-- 2. Согласие клиента на ПД при публичном бронировании
-- (см. src/app/api/public/booking/[slug]/create)
-- ------------------------------------------------------------
alter table sessions
  add column if not exists client_consent_accepted_at timestamptz;

-- ------------------------------------------------------------
-- 3a. messages.kind — добавляем 'broadcast' в допустимые значения.
-- DO-блок безопасен в обоих случаях: если constraint уже был —
-- пересоздаётся с добавленным значением; если не было — создаётся новый.
-- ------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'messages' and column_name = 'kind'
  ) then
    alter table messages drop constraint if exists messages_kind_check;
  end if;
end $$;

alter table messages
  add constraint messages_kind_check
  check (kind in ('message', 'homework', 'session_invite', 'broadcast'));

-- ------------------------------------------------------------
-- 3b. sessions.recording_status — добавляем 'stopped_by_client'
-- (кнопка «Остановить запись», доступная клиенту в UI звонка).
-- Констрейнт уже создан в migration_007_video_asr.sql как безымянный
-- inline CHECK при ADD COLUMN — находим его реальное имя через
-- information_schema вместо того, чтобы гадать автосгенерированное имя.
-- ------------------------------------------------------------
do $$
declare
  constraint_name_var text;
begin
  select tc.constraint_name into constraint_name_var
  from information_schema.constraint_column_usage ccu
  join information_schema.table_constraints tc on tc.constraint_name = ccu.constraint_name
  where ccu.table_name = 'sessions'
    and ccu.column_name = 'recording_status'
    and tc.constraint_type = 'CHECK';

  if constraint_name_var is not null then
    execute format('alter table sessions drop constraint %I', constraint_name_var);
  end if;
end $$;

alter table sessions add constraint sessions_recording_status_check
  check (recording_status in ('none', 'recording', 'processing', 'ready', 'failed', 'stopped_by_client'));
