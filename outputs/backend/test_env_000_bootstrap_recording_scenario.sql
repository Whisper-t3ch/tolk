-- ============================================================
-- test_env_000_bootstrap_recording_scenario.sql
--
-- НЕ для production. Минимальный набор объектов ТОЛЬКО для изолированного
-- тестового Supabase-проекта, воспроизводящий сценарий "регистрация →
-- создание консультации → звонок → запись → сборка" ветки
-- recording-signed-upload-24-09. Составлен 25.09.2026 путём прямого
-- чтения живой прод-схемы (gprmbaiacvchtovzpeqa) — НЕ по историческим
-- файлам migration_004..035, которых для базовых таблиц не существует
-- (psychologists/clients/sessions создавались в проде до появления
-- нумерованных миграций и ни в одном файле не зафиксированы; журнал
-- Supabase list_migrations тоже неполный — 3 записи на 39+ реальных
-- изменений схемы).
--
-- Сознательно НЕ включено (не нужно для этого сценария, не входит в
-- проверяемый функционал — подтверждено grep по всему src, ни один
-- активный route их не трогает): ассистент/чат, база знаний,
-- SOAP-протоколы, биллинг/LLM-usage-log, session_transcripts,
-- session_transcript_segments (Этап 3 "сборка расшифровки" в коде ещё
-- не существует).
--
-- Порядок применения к ПУСТОМУ Supabase-проекту:
--   1. этот файл (включает bucket + Storage RLS в конце)
--   2. migration_038_recording_attempt_id.sql — БЕЗ ИЗМЕНЕНИЙ (файл
--      содержит только "Часть 1" как исполняемый SQL, "Часть 2"
--      целиком закомментирована и не выполняется)
--   3. migration_039_recording_checksum_verified.sql — без изменений
--
-- Каждый объект ниже сверен 25.09.2026 напрямую с живой прод-схемой
-- (information_schema, pg_constraint, pg_policies, pg_get_functiondef,
-- pg_get_constraintdef) — не реконструкция по памяти или по файлам.
-- ============================================================

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- 1. psychologists
-- ------------------------------------------------------------
create table if not exists public.psychologists (
  id uuid primary key,
  email text not null,
  name text,
  specialty text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  storage_plan text default 'none' check (storage_plan in ('none','audio','video','both')),
  storage_auto_delete_days integer default 30,
  assistant_requests_used integer default 0,
  assistant_requests_limit integer default 60,
  assistant_requests_reset_at timestamptz default (date_trunc('month', now()) + interval '1 month'),
  plan_name text not null default 'beta' check (plan_name in ('beta','practice','professional','expert')),
  approach text check (approach in ('cbt','gestalt','psychoanalysis','schema','existential','integrative','other')),
  typical_client_request text,
  onboarding_completed_at timestamptz,
  default_template_id text not null default 'soap',
  terms_accepted_at timestamptz,
  terms_version text default 'v1',
  timezone text not null default 'Europe/Moscow'
);

alter table public.psychologists enable row level security;

drop policy if exists "psychologists_insert_own" on public.psychologists;
create policy "psychologists_insert_own" on public.psychologists
  for insert with check (auth.uid() = id);

drop policy if exists "psychologists_select_own" on public.psychologists;
create policy "psychologists_select_own" on public.psychologists
  for select using (auth.uid() = id);

drop policy if exists "psychologists_update_own" on public.psychologists;
create policy "psychologists_update_own" on public.psychologists
  for update using (auth.uid() = id);

-- ------------------------------------------------------------
-- 2. clients
-- ------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  psychologist_id uuid not null references public.psychologists(id),
  name text not null,
  request text,
  approach text,
  status text not null default 'active' check (status in ('active','pause','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  age integer,
  gender text check (gender in ('male','female')),
  joined_date date not null default current_date,
  needs_attention boolean not null default false,
  hw_completed integer not null default 0,
  hw_total integer not null default 0
);

alter table public.clients enable row level security;

drop policy if exists "clients_insert_own" on public.clients;
create policy "clients_insert_own" on public.clients
  for insert with check (auth.uid() = psychologist_id);

drop policy if exists "clients_select_own" on public.clients;
create policy "clients_select_own" on public.clients
  for select using (auth.uid() = psychologist_id and deleted_at is null);

drop policy if exists "clients_update_own" on public.clients;
create policy "clients_update_own" on public.clients
  for update using (auth.uid() = psychologist_id);

drop policy if exists "clients_delete_own" on public.clients;
create policy "clients_delete_own" on public.clients
  for delete using (auth.uid() = psychologist_id);

-- ------------------------------------------------------------
-- 3. sessions
-- ------------------------------------------------------------
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  psychologist_id uuid not null references public.psychologists(id),
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 50,
  status text not null default 'scheduled' check (status in ('scheduled','in_progress','completed','cancelled','pending_payment')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  booked_via text default 'psychologist' check (booked_via in ('psychologist','public_link')),
  client_contact_name text,
  client_contact_telegram text,
  jitsi_room_name text,
  recording_status text not null default 'none',
  recording_started_at timestamptz,
  recording_url text,
  transcript_error text,
  client_consent_accepted_at timestamptz,
  recording_manifest jsonb,
  recording_heartbeat_at timestamptz,
  recording_client_state text
);

alter table public.sessions add constraint sessions_recording_status_check
  check (recording_status in ('none','recording','uploading','processing','ready','failed','incomplete','stopped_by_client'));

alter table public.sessions enable row level security;

drop policy if exists "sessions_insert_own" on public.sessions;
create policy "sessions_insert_own" on public.sessions
  for insert with check (auth.uid() = psychologist_id);

drop policy if exists "sessions_select_own" on public.sessions;
create policy "sessions_select_own" on public.sessions
  for select using (auth.uid() = psychologist_id and deleted_at is null);

drop policy if exists "sessions_update_own" on public.sessions;
create policy "sessions_update_own" on public.sessions
  for update using (auth.uid() = psychologist_id);

drop policy if exists "sessions_delete_own" on public.sessions;
create policy "sessions_delete_own" on public.sessions
  for delete using (auth.uid() = psychologist_id);

-- ------------------------------------------------------------
-- 4. updated_at триггеры + автосоздание psychologists при регистрации
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

drop trigger if exists trg_psychologists_updated_at on public.psychologists;
create trigger trg_psychologists_updated_at before update on public.psychologists
  for each row execute function public.set_updated_at();

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

drop trigger if exists trg_sessions_updated_at on public.sessions;
create trigger trg_sessions_updated_at before update on public.sessions
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $function$
begin
  insert into public.psychologists (id, email)
  values (new.id, new.email);
  return new;
end;
$function$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 5. session_recording_chunks — ИСХОДНАЯ форма (как в migration_036),
-- с ОРИГИНАЛЬНЫМ constraint (session_id, track, sequence). Вносится
-- нарочно как есть, а не сразу в целевом виде: следующий шаг
-- (migration_038) должен САМ снести этот constraint и заменить его —
-- тест должен проверять именно этот переход, а не начинать с готового
-- результата.
-- ------------------------------------------------------------
create table if not exists public.session_recording_chunks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  track text not null check (track in ('psychologist','client')),
  sequence int not null,
  storage_key text not null,
  mime_type text not null,
  size_bytes int not null check (size_bytes > 0),
  checksum text not null,
  started_at_ms int not null check (started_at_ms >= 0),
  duration_ms int not null check (duration_ms >= 0),
  uploaded_at timestamptz not null default now(),
  unique (session_id, track, sequence)
);

create index if not exists idx_session_recording_chunks_session
  on public.session_recording_chunks(session_id, track, sequence);

alter table public.session_recording_chunks enable row level security;

drop policy if exists "own_recording_chunks_select" on public.session_recording_chunks;
create policy "own_recording_chunks_select" on public.session_recording_chunks
  for select using (
    exists (select 1 from public.sessions s where s.id = session_recording_chunks.session_id and s.psychologist_id = auth.uid())
  );

drop policy if exists "own_recording_chunks_insert" on public.session_recording_chunks;
create policy "own_recording_chunks_insert" on public.session_recording_chunks
  for insert with check (
    exists (select 1 from public.sessions s where s.id = session_recording_chunks.session_id and s.psychologist_id = auth.uid())
  );

drop policy if exists "own_recording_chunks_delete" on public.session_recording_chunks;
create policy "own_recording_chunks_delete" on public.session_recording_chunks
  for delete using (
    exists (select 1 from public.sessions s where s.id = session_recording_chunks.session_id and s.psychologist_id = auth.uid())
  );

-- ------------------------------------------------------------
-- 6. Storage: bucket session-recordings + RLS (содержимое
-- migration_037, без изменений)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'session-recordings', 'session-recordings', false, 10485760,
  array['audio/webm','audio/mp4','audio/ogg','audio/wav','application/octet-stream']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "own_session_recordings_insert" on storage.objects;
create policy "own_session_recordings_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'session-recordings'
    and exists (select 1 from public.sessions s where s.id::text = (storage.foldername(name))[2] and s.psychologist_id = auth.uid())
  );

drop policy if exists "own_session_recordings_update" on storage.objects;
create policy "own_session_recordings_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'session-recordings'
    and exists (select 1 from public.sessions s where s.id::text = (storage.foldername(name))[2] and s.psychologist_id = auth.uid())
  )
  with check (
    bucket_id = 'session-recordings'
    and exists (select 1 from public.sessions s where s.id::text = (storage.foldername(name))[2] and s.psychologist_id = auth.uid())
  );

drop policy if exists "own_session_recordings_select" on storage.objects;
create policy "own_session_recordings_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'session-recordings'
    and exists (select 1 from public.sessions s where s.id::text = (storage.foldername(name))[2] and s.psychologist_id = auth.uid())
  );
