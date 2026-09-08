-- ============================================================
-- migration_011_test_questionnaires.sql
--
-- Превращает "тесты" из текстовых описаний методик в реальные
-- интерактивные опросники: таблица со структурой вопросов/шкалы/
-- ключей подсчёта на каждый тест + токен-based публичная выдача
-- клиенту (аналог booking_settings.public_slug для /book/[slug]).
--
-- Архитектура:
-- 1. test_questionnaires — справочник опросников. Одна строка на
--    test_key (не привязана к psychologist_id — методики общие для
--    всех, как и knowledge_base seed-контент). Хранит вопросы,
--    варианты ответов, ключи подсчёта и интерпретацию как JSONB —
--    подсчёт (учёт обратных вопросов, субшкал) делает код на бэкенде
--    (src/lib/testQuestionnaires.ts), а не SQL, поэтому реляционного
--    разворачивания на вопросы/варианты не требуется.
-- 2. test_results получает access_token (публичная ссылка клиенту)
--    и questionnaire_key (какой опросник использовать при подсчёте) —
--    остальные поля (score/max_score/interpretation/answers/status)
--    уже существуют.
--
-- Применять через Supabase SQL Editor. Все операции идемпотентны —
-- безопасно применять повторно.
-- ============================================================

create table if not exists test_questionnaires (
  id uuid primary key default gen_random_uuid(),
  -- Ключ методики — то же значение, что test_results.test_type и
  -- новое test_results.questionnaire_key. Для 5 старых клинических
  -- шкал совпадает с TestType ("PHQ9" и т.д.), для новых тестов из
  -- базы знаний — короткий латинский слаг (например "SZHO", "ROSENBERG").
  test_key text not null unique,
  title text not null,
  -- Короткая инструкция клиенту, показывается над вопросами
  -- ("Оцените, как часто за последние 2 недели вас беспокоило...")
  instructions text,
  -- Полная структура опросника, формат согласован с
  -- src/lib/testQuestionnaires.ts:
  -- {
  --   "responseScale": [{ "value": 0, "label": "Никогда" }, ...],  // общая шкала, если одна на все вопросы
  --   "questions": [
  --     { "id": "q1", "text": "...", "reverse": false, "subscale": "somatic",
  --       "responseScale": [...] }  // переопределение шкалы для конкретного вопроса, опционально
  --   ],
  --   "subscales": [{ "key": "somatic", "label": "Соматическая тревога" }],  // опционально
  --   "scoring": "sum" | "average",  // как из баллов по вопросам получить итог(ы)
  --   "ranges": [{ "upTo": 4, "label": "Минимальная выраженность" }, ...],  // интерпретация общего балла
  --   "subscaleRanges": { "somatic": [{ "upTo": 4, "label": "..." }] }  // опционально, по субшкалам
  -- }
  schema jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table test_questionnaires is
  'Справочник структур психодиагностических опросников (вопросы, шкала ответов, ключи подсчёта, интерпретация) — общий для всех психологов, наполняется вручную/скриптом по мере переноса тестов из knowledge_base в интерактивный формат.';

create index if not exists idx_test_questionnaires_test_key on test_questionnaires(test_key);

-- test_results: добавляем поля для публичного прохождения теста клиентом.
alter table test_results
  add column if not exists access_token text unique,
  add column if not exists questionnaire_key text,
  add column if not exists completed_at timestamptz;

comment on column test_results.access_token is
  'Случайный токен для публичной ссылки /test/[token] — клиент проходит тест без авторизации по знанию токена, аналогично booking_settings.public_slug.';
comment on column test_results.questionnaire_key is
  'Ссылка на test_questionnaires.test_key — какую структуру вопросов использовать. NULL для старых записей, где балл вносился вручную психологом (пока не по единому опроснику).';

create index if not exists idx_test_results_access_token on test_results(access_token);
