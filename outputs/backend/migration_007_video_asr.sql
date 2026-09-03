-- ============================================================
-- migration_007_video_asr.sql
--
-- Реальная видео/ASR-интеграция (Трек Б): поля на sessions для
-- Jitsi-комнаты и статуса записи/расшифровки. До этой миграции
-- sessions не хранила вообще никакой информации о видеозвонке —
-- ConferenceModal/session/[id] работали на чистой фронтенд-бутафории
-- (см. security/consistency review 2026-09-02).
--
-- Применять через Supabase SQL Editor, как и предыдущие миграции.
-- Все ALTER TABLE идемпотентны (IF NOT EXISTS) — безопасно повторно
-- применять поверх уже накатанной части, если она была применена
-- вручную ранее.
-- ============================================================

-- ------------------------------------------------------------
-- Jitsi-комната сессии
-- ------------------------------------------------------------
alter table sessions
  add column if not exists jitsi_room_name text;

alter table sessions
  add column if not exists video_room_url text;

-- ------------------------------------------------------------
-- Статус записи (Jibri) и расшифровки (GigaAM)
-- ------------------------------------------------------------
alter table sessions
  add column if not exists recording_status text
    not null default 'none'
    check (recording_status in ('none', 'recording', 'processing', 'ready', 'failed'));

alter table sessions
  add column if not exists recording_started_at timestamptz;

alter table sessions
  add column if not exists recording_url text;

alter table sessions
  add column if not exists transcript_error text;

create index if not exists idx_sessions_recording_status
  on sessions(recording_status)
  where recording_status in ('recording', 'processing');

-- ------------------------------------------------------------
-- session_transcripts.source — соответствие с lib/prompts/soap.ts
-- (SOAP_SYSTEM_PROMPT_JITSI_GIGAAM vs _MANUAL_DEGRADE). Колонка,
-- судя по комментариям в коде, уже была спроектирована ранее —
-- ALTER здесь идемпотентен на случай, если её ещё нет.
-- ------------------------------------------------------------
alter table session_transcripts
  add column if not exists source text
    not null default 'manual'
    check (source in ('jitsi_gigaam', 'manual'));

alter table session_transcripts
  add column if not exists duration_seconds integer;
