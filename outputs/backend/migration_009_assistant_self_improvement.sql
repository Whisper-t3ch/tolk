-- ============================================================
-- migration_009_assistant_self_improvement.sql
--
-- Система сбора обратной связи и самоулучшения ассистента по
-- подходам психологов (КПТ, гештальт и т.д.) — НЕ персонализация
-- под конкретного психолога, а общее улучшение стиля ответов для
-- каждого approach на основе агрегированной статистики.
--
-- Этот файл реализует то, что ТЗ относит к разделу "Сейчас (не
-- требует сервера)": схему БД (п.1) и опору для сбора фидбека (п.2).
-- Cron-анализ, A/B-логика и автопринятие решений (п.3-5, 7) —
-- отложены до накопления данных на бете, таблицы под них уже
-- созданы здесь, чтобы не делать вторую миграцию позже.
--
-- Применять через Supabase SQL Editor. Все операции идемпотентны —
-- безопасно применять повторно.
-- ============================================================

-- ------------------------------------------------------------
-- prompt_versions — версии инкрементальных добавок к системному
-- промпту ассистента, отдельно на каждый approach. Базовый промпт
-- (этика, безопасность, структура ответа) сюда не входит и живёт
-- в коде (AGENT_SYSTEM_PROMPT, src/lib/agent/tools.ts) — этот текст
-- никогда не редактируется автоматикой.
-- ------------------------------------------------------------
create table if not exists prompt_versions (
  id uuid primary key default gen_random_uuid(),
  approach text not null,
  version_number int not null,
  prompt_additions text not null default '',
  status text not null default 'testing' check (status in ('testing', 'active', 'rejected', 'rolled_back')),
  traffic_percentage int not null default 20 check (traffic_percentage >= 0 and traffic_percentage <= 100),
  positive_rate numeric,
  sample_size int not null default 0,
  based_on_feedback_count int,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  rolled_back_at timestamptz,
  unique (approach, version_number)
);

comment on table prompt_versions is
  'Версии стилевых добавок к системному промпту ассистента по approach. prompt_additions — ТОЛЬКО добавка поверх неизменного базового промпта (см. AGENT_SYSTEM_PROMPT в коде), не полная замена. Не видна психологам напрямую.';
comment on column prompt_versions.prompt_additions is
  'Инкрементальные инструкции по стилю/длине/терминологии для конкретного approach. Ограничение ~500 слов проверяется в коде перед созданием записи, не в БД.';

create index if not exists idx_prompt_versions_approach_status on prompt_versions(approach, status);

-- Только одна активная версия на approach одновременно.
create unique index if not exists idx_prompt_versions_one_active_per_approach
  on prompt_versions(approach)
  where status = 'active';

-- ------------------------------------------------------------
-- prompt_evolution_log — человекочитаемый журнал того, что и почему
-- менялось в промптах, с результатами A/B теста. Только сервисный
-- доступ (админ/cron), не для психологов.
-- ------------------------------------------------------------
create table if not exists prompt_evolution_log (
  id uuid primary key default gen_random_uuid(),
  approach text not null,
  from_version_id uuid references prompt_versions(id) on delete set null,
  to_version_id uuid references prompt_versions(id) on delete set null,
  change_summary text not null,
  ab_test_result jsonb,
  action text not null check (action in ('applied', 'rejected', 'rolled_back')),
  created_at timestamptz not null default now()
);

create index if not exists idx_prompt_evolution_log_approach on prompt_evolution_log(approach);

-- ------------------------------------------------------------
-- assistant_feedback — явная и неявная обратная связь по каждому
-- ответу ассистента. Копия approach психолога на момент ответа
-- сохраняется отдельно (не через join к psychologists), чтобы
-- анализ за прошлые периоды не искажался, если психолог сменит
-- подход в профиле позже.
-- ------------------------------------------------------------
create table if not exists assistant_feedback (
  id uuid primary key default gen_random_uuid(),
  psychologist_id uuid not null references psychologists(id) on delete cascade,
  approach text not null,
  agent_session_id uuid references agent_sessions(id) on delete set null,
  message_id uuid,
  question text not null,
  answer text not null,
  rating text not null default 'neutral' check (rating in ('positive', 'negative', 'neutral')),
  was_used boolean not null default false,
  was_reformulated boolean not null default false,
  prompt_version_id uuid references prompt_versions(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_assistant_feedback_psychologist on assistant_feedback(psychologist_id);
create index if not exists idx_assistant_feedback_approach_created on assistant_feedback(approach, created_at);
create index if not exists idx_assistant_feedback_message on assistant_feedback(message_id);
create index if not exists idx_assistant_feedback_prompt_version on assistant_feedback(prompt_version_id);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table assistant_feedback enable row level security;
alter table prompt_versions enable row level security;
alter table prompt_evolution_log enable row level security;

-- Психолог может создавать и обновлять ТОЛЬКО свою обратную связь
-- (обновление нужно для явного rating/was_used, проставляемых уже
-- после исходной вставки со стороны сервера). Чтение агрегированной
-- статистики по всем психологам с данным approach — задача cron-задач,
-- которые используют service role и обходят RLS, поэтому отдельная
-- select-политика психологу не нужна и не даётся: ТЗ прямо требует,
-- чтобы обычный психолог не мог прочитать чужие диалоги через RLS.
create policy "insert_own_feedback" on assistant_feedback
  for insert
  with check (psychologist_id = auth.uid());

create policy "update_own_feedback" on assistant_feedback
  for update
  using (psychologist_id = auth.uid())
  with check (psychologist_id = auth.uid());

-- prompt_versions и prompt_evolution_log — никаких policy для
-- authenticated не создаём: RLS включён и по умолчанию блокирует
-- всё, кроме service role (который RLS не проходит вообще). Это
-- соответствует ТЗ "только сервисный доступ, не видны напрямую
-- психологам".
