-- ============================================================
-- test_env_001_soap_notes_knowledge_base_minimal.sql
--
-- НЕ для production. Дополнение ТОЛЬКО для изолированного тестового
-- Supabase-проекта (jjwfmcxiogcjunuoziau, "tolk-test-recording"),
-- применяется ПОСЛЕ test_env_000_bootstrap_recording_scenario.sql +
-- migration_038 + migration_039.
--
-- ПРИЧИНА (обнаружено 25.09.2026 живым тестом на Preview-деплое ветки
-- recording-signed-upload-24-09, подтверждено runtime-логами Vercel и
-- чтением исходников): страница звонка /session/[id] при КАЖДОЙ
-- загрузке безусловно вызывает GET /api/sessions/[id]/soap
-- (src/app/(app)/session/[id]/page.tsx, строка 76), и этот route
-- безусловно читает soap_notes и knowledge_base
-- (src/app/api/sessions/[id]/soap/route.ts) — не только когда есть
-- сохранённая SOAP-заметка. Этих таблиц не было в
-- test_env_000_bootstrap_recording_scenario.sql: та миграция считала
-- SOAP-протоколы "вне scope, ни один активный route их не трогает" —
-- эта формулировка оказалась неверной для страницы звонка конкретно
-- (route .../soap — часть загрузки ЛЮБОЙ сессии, не только SOAP-
-- функциональности как таковой). Итог до этой миграции: GET .../soap
-- падал с 500 на каждой попытке открыть звонок, UI показывал
-- "Не удалось загрузить сессию" — независимо от записи, ключей
-- Supabase/Vercel и миграций 038/039 (все они были верны).
--
-- ПРОВЕРЕНО ПЕРЕД СОСТАВЛЕНИЕМ (25.09.2026, чтение исходников через
-- device bridge, не предположение):
--   - src/app/api/sessions/[id]/soap/route.ts (GET) выбирает из
--     soap_notes только: id, s_subjective, o_objective, a_assessment,
--     p_plan, client_summary, client_summary_sent_at,
--     protocol_template_id, created_at, updated_at — НЕ использует
--     transcript_id и НЕ использует embedding из knowledge_base.
--   - grep по "src/app/(app)/session/[id]/page.tsx" — единственные
--     два fetch() на этой странице оба идут на .../soap (GET и,
--     ниже, сохранение S/O/A/P). Никаких обращений к /api/messages
--     или /api/homework/summary со страницы звонка или из
--     src/app/(app)/layout.tsx нет — эти два route используются
--     только страницами clients/dashboard/knowledge (подтверждено
--     grep), то есть НЕ являются зависимостью этого сценария и
--     сознательно не добавляются здесь.
--
-- УПРОЩЕНИЯ ОТНОСИТЕЛЬНО ПРОД-СХЕМЫ (gprmbaiacvchtovzpeqa, сверено
-- напрямую через information_schema/pg_constraint/pg_policies
-- 25.09.2026) — допустимы ТОЛЬКО в этом тестовом сценарии, см. проверку
-- выше:
--   - soap_notes.transcript_id: в проде FK на session_transcripts(id)
--     ON DELETE SET NULL. session_transcripts сознательно исключена
--     из test_env_000 (Этап 3 "сборка расшифровки" в коде ещё не
--     реализован). Здесь столбец есть (для совместимости состава
--     колонок), но БЕЗ внешнего ключа — просто nullable uuid.
--   - knowledge_base.embedding (pgvector) не добавлен: требует
--     отдельного расширения vector, используется только поиском базы
--     знаний ассистента (вне scope), route .../soap этот столбец не
--     запрашивает.
--
-- Обе таблицы создаются пустыми — риска для существующих тестовых
-- данных (session_recording_chunks, recording_attempts и т.д.) нет.
-- RLS-политики скопированы 1:1 с прод-схемы.
-- ============================================================

-- ------------------------------------------------------------
-- knowledge_base (минимальный срез — используется как FK-цель
-- soap_notes.protocol_template_id и напрямую route'ом .../soap)
-- ------------------------------------------------------------
create table if not exists public.knowledge_base (
  id uuid primary key default gen_random_uuid(),
  psychologist_id uuid not null references public.psychologists(id) on delete cascade,
  title text,
  content text not null,
  source_type text check (source_type = any (array['technique', 'article', 'protocol', 'manual', 'homework', 'test'])),
  approach text,
  topic text,
  questionnaire_key text,
  created_at timestamptz not null default now()
);

alter table public.knowledge_base enable row level security;

drop policy if exists "own_knowledge" on public.knowledge_base;
create policy "own_knowledge" on public.knowledge_base
  for all
  using (psychologist_id = auth.uid());

-- ------------------------------------------------------------
-- soap_notes
-- ------------------------------------------------------------
create table if not exists public.soap_notes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  transcript_id uuid, -- см. шапку: без FK на session_transcripts в этом тесте
  s_subjective text,
  o_objective text,
  a_assessment text,
  p_plan text,
  ai_generated boolean not null default true,
  prompt_variant text check (prompt_variant = any (array['jitsi_gigaam', 'manual_degrade'])),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_summary text,
  client_summary_sent_at timestamptz,
  protocol_template_id uuid references public.knowledge_base(id) on delete set null
);

alter table public.soap_notes enable row level security;

drop policy if exists "soap_notes_select_own" on public.soap_notes;
create policy "soap_notes_select_own" on public.soap_notes
  for select
  using (exists (select 1 from public.sessions s where s.id = soap_notes.session_id and s.psychologist_id = auth.uid()));

drop policy if exists "soap_notes_insert_own" on public.soap_notes;
create policy "soap_notes_insert_own" on public.soap_notes
  for insert
  with check (exists (select 1 from public.sessions s where s.id = soap_notes.session_id and s.psychologist_id = auth.uid()));

drop policy if exists "soap_notes_update_own" on public.soap_notes;
create policy "soap_notes_update_own" on public.soap_notes
  for update
  using (exists (select 1 from public.sessions s where s.id = soap_notes.session_id and s.psychologist_id = auth.uid()));

-- ------------------------------------------------------------
-- Проверки после применения (выполнить вручную):
--
-- select table_name from information_schema.tables
--   where table_schema='public' and table_name in ('soap_notes','knowledge_base');
--   → обе должны существовать.
--
-- select tablename, policyname, cmd from pg_policies
--   where tablename in ('soap_notes','knowledge_base') order by 1,2;
--   → 1 политика (ALL) на knowledge_base, 3 (select/insert/update) на soap_notes.
-- ------------------------------------------------------------
