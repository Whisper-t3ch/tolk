-- ============================================================
-- migration_036_browser_recording.sql
--
-- Переход с серверной записи (Jibri) на браузерную запись двух
-- аудиодорожек в браузере психолога. Решение принято 22.09.
--
-- Что меняется по сути. Раньше запись была ОДНИМ файлом, который
-- Jibri клал на диск ВМ и отдавал платформе одним `recording_url`
-- (migration_007). Теперь запись — это ДВЕ дорожки (психолог и
-- клиент), каждая нарезана на фрагменты по 15-30 секунд, которые
-- браузер выгружает в объектное хранилище по мере записи. Поэтому:
--
--   * одного recording_url больше не достаточно — нужен реестр
--     фрагментов, чтобы проверить, что запись доехала целиком;
--   * транскрипт перестаёт быть плоским текстом — раздельные дорожки
--     дают готовую разметку по спикерам без диаризации, и терять её,
--     склеивая всё в один текст, было бы потерей главного
--     преимущества архитектуры.
--
-- Что сознательно НЕ трогаем: session_transcripts.raw_text остаётся
-- источником для SOAP, суммаризации и RAG-чанкинга. Он собирается из
-- сегментов как диалог ("Психолог: ... / Клиент: ...") — весь
-- существующий пайплайн (soap.ts, periodSummary.ts,
-- transcriptChunking.ts, match_session_transcript_chunks) продолжает
-- работать без изменений, а сегменты добавляют детализацию сверху.
--
-- Применять через Supabase SQL Editor. Все операции идемпотентны.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Реестр фрагментов записи
--
-- Каждая строка — один Blob, который браузер психолога нарезал и
-- выгрузил. Нужен именно реестр в БД, а не просто список объектов в
-- хранилище: по нему backend проверяет целостность (все ли номера на
-- месте, нет ли дублей, совпал ли checksum) прежде чем отправлять
-- запись в ASR. Листинг бакета этого не даёт — там не видно, сколько
-- фрагментов ДОЛЖНО быть.
--
-- ВАЖНО: фрагмент не является самостоятельным аудиофайлом. При записи
-- в WebM/Opus заголовок контейнера попадает только в фрагмент с
-- sequence = 0, остальные — продолжение потока. Сборка дорожки
-- (FFmpeg remux) обязательна перед расшифровкой.
-- ------------------------------------------------------------
create table if not exists session_recording_chunks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  track text not null check (track in ('psychologist', 'client')),
  -- Сквозной номер внутри дорожки, начиная с 0. Дыра в нумерации =
  -- потерянный фрагмент, это и есть главный признак неполной записи.
  sequence int not null,
  -- Ключ объекта в хранилище: recordings/{session_id}/{track}/{NNNNNN}.{ext}
  storage_key text not null,
  mime_type text not null,
  size_bytes int not null check (size_bytes > 0),
  -- "sha256:<hex>", считается в браузере до выгрузки. Сверяется при
  -- приёме — отличает «фрагмент дошёл целым» от «дошёл битым».
  checksum text not null,
  -- Смещение от начала записи дорожки и фактическая длительность.
  -- Нужны, чтобы свести сегменты двух дорожек в единый диалог по
  -- времени, и чтобы увидеть разрыв при переподключении клиента.
  started_at_ms int not null check (started_at_ms >= 0),
  duration_ms int not null check (duration_ms >= 0),
  uploaded_at timestamptz not null default now(),
  -- Повторная выгрузка того же фрагмента (retry после сбоя сети) не
  -- должна плодить дубли — upsert по этому ключу делает приём
  -- идемпотентным.
  unique (session_id, track, sequence)
);

create index if not exists idx_session_recording_chunks_session
  on session_recording_chunks(session_id, track, sequence);

alter table session_recording_chunks enable row level security;

-- Тот же паттерн, что у session_transcript_chunks (migration_034):
-- доступ через JOIN до sessions.psychologist_id, без денормализации.
--
-- drop ... if exists перед каждым create: у CREATE POLICY нет формы
-- IF NOT EXISTS, и без явного drop повторный прогон миграции падает
-- на "policy already exists" (проверено на PostgreSQL 16).
drop policy if exists "own_recording_chunks_select" on session_recording_chunks;
create policy "own_recording_chunks_select" on session_recording_chunks
  for select using (
    exists (
      select 1 from sessions s
      where s.id = session_recording_chunks.session_id
        and s.psychologist_id = auth.uid()
    )
  );

drop policy if exists "own_recording_chunks_insert" on session_recording_chunks;
create policy "own_recording_chunks_insert" on session_recording_chunks
  for insert with check (
    exists (
      select 1 from sessions s
      where s.id = session_recording_chunks.session_id
        and s.psychologist_id = auth.uid()
    )
  );

drop policy if exists "own_recording_chunks_delete" on session_recording_chunks;
create policy "own_recording_chunks_delete" on session_recording_chunks
  for delete using (
    exists (
      select 1 from sessions s
      where s.id = session_recording_chunks.session_id
        and s.psychologist_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- 2. Сегменты транскрипта со спикерами
--
-- Раздельные дорожки дают точную атрибуцию реплик бесплатно —
-- диаризация не нужна. Храним сегменты отдельно, а не только склеенным
-- текстом, потому что по ним можно: показать психологу реплики с
-- таймкодами, посчитать распределение времени говорения, переобработать
-- одного спикера, не трогая второго.
-- ------------------------------------------------------------
create table if not exists session_transcript_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  speaker text not null check (speaker in ('psychologist', 'client')),
  -- Позиция в сведённом по времени диалоге (обе дорожки вместе).
  ordinal int not null,
  start_ms int not null check (start_ms >= 0),
  end_ms int not null check (end_ms >= 0),
  -- Текст УЖЕ анонимизированный: как и в webhooks/recording, сырой
  -- вывод ASR не доживает до первой записи в БД.
  text text not null,
  created_at timestamptz not null default now(),
  unique (session_id, ordinal)
);

create index if not exists idx_session_transcript_segments_session
  on session_transcript_segments(session_id, ordinal);

alter table session_transcript_segments enable row level security;

drop policy if exists "own_transcript_segments_select" on session_transcript_segments;
create policy "own_transcript_segments_select" on session_transcript_segments
  for select using (
    exists (
      select 1 from sessions s
      where s.id = session_transcript_segments.session_id
        and s.psychologist_id = auth.uid()
    )
  );

drop policy if exists "own_transcript_segments_insert" on session_transcript_segments;
create policy "own_transcript_segments_insert" on session_transcript_segments
  for insert with check (
    exists (
      select 1 from sessions s
      where s.id = session_transcript_segments.session_id
        and s.psychologist_id = auth.uid()
    )
  );

drop policy if exists "own_transcript_segments_delete" on session_transcript_segments;
create policy "own_transcript_segments_delete" on session_transcript_segments
  for delete using (
    exists (
      select 1 from sessions s
      where s.id = session_transcript_segments.session_id
        and s.psychologist_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- 3. Manifest и runtime-контроль на sessions
--
-- Manifest браузер присылает после остановки записи: какие дорожки,
-- в каком формате, с какого по какой номер. Без него backend не знает,
-- сколько фрагментов ДОЛЖНО было приехать, и не может отличить
-- «запись закончилась» от «вкладка психолога умерла на середине».
--
-- Heartbeat браузер шлёт каждые 10-15 секунд во время консультации.
-- Он нужен, чтобы поймать молчаливый отказ: MediaRecorder остановился,
-- удалённая дорожка исчезла, очередь невыгруженных фрагментов растёт.
-- Одного preflight для этого недостаточно.
-- ------------------------------------------------------------
alter table sessions
  add column if not exists recording_manifest jsonb;

alter table sessions
  add column if not exists recording_heartbeat_at timestamptz;

-- Последнее известное состояние рекордера из heartbeat — чтобы
-- показать психологу подтверждённый статус ("запись идёт", "запись
-- клиента прервана"), а не просто красную точку.
alter table sessions
  add column if not exists recording_client_state text;

-- ------------------------------------------------------------
-- 3a. Новые значения recording_status
--
--   uploading  — запись остановлена, но не все фрагменты доехали.
--                Отдельный статус нужен, потому что это НЕ ошибка и
--                НЕ готовность: сессию ещё рано отдавать в ASR.
--   incomplete — manifest не сошёлся с реестром фрагментов (дыра в
--                нумерации, битый checksum, вкладка закрылась). Запись
--                частично есть и её можно расшифровать, но психолога
--                нужно предупредить, что фрагмент разговора отсутствует.
--
-- 'stopped_by_client' сохраняем: в браузерной архитектуре клиент
-- ничего не записывает, но кнопка отзыва согласия на запись остаётся
-- за ним, и значение уже могло попасть в данные (migration_008).
--
-- Констрейнт мог быть создан как безымянный inline CHECK в
-- migration_007 либо под именем sessions_recording_status_check в
-- migration_008 — ищем реальное имя вместо того, чтобы гадать.
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
  check (recording_status in (
    'none', 'recording', 'uploading', 'processing', 'ready',
    'failed', 'incomplete', 'stopped_by_client'
  ));

-- ------------------------------------------------------------
-- 4. session_transcripts.source — происхождение расшифровки
--
-- 'jitsi_browser' — новая браузерная запись двух дорожек.
-- 'jitsi_gigaam'  — старая Jibri-запись одним файлом. Значение
--                   остаётся допустимым, чтобы уже существующие
--                   строки не нарушили констрейнт; новые записи с ним
--                   не создаются.
-- ------------------------------------------------------------
do $$
declare
  constraint_name_var text;
begin
  select tc.constraint_name into constraint_name_var
  from information_schema.constraint_column_usage ccu
  join information_schema.table_constraints tc on tc.constraint_name = ccu.constraint_name
  where ccu.table_name = 'session_transcripts'
    and ccu.column_name = 'source'
    and tc.constraint_type = 'CHECK';

  if constraint_name_var is not null then
    execute format('alter table session_transcripts drop constraint %I', constraint_name_var);
  end if;
end $$;

alter table session_transcripts add constraint session_transcripts_source_check
  check (source in ('jitsi_browser', 'jitsi_gigaam', 'manual'));

-- ------------------------------------------------------------
-- 5. Проверки после применения (выполнить вручную, не автоматизируется)
--
-- select recording_status, count(*) from sessions group by 1;
--   → убедиться, что старые значения не нарушают новый констрейнт.
--
-- select source, count(*) from session_transcripts group by 1;
--   → то же для source.
--
-- select tablename, rowsecurity from pg_tables
--   where tablename in ('session_recording_chunks', 'session_transcript_segments');
--   → rowsecurity должен быть true у обеих.
-- ------------------------------------------------------------
