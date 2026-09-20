-- ============================================================
-- migration_032_llm_usage_log.sql
--
-- Полная телеметрия стоимости запросов к ассистенту (задача "рычаг 4",
-- 20.09). Раньше единственным источником данных о стоимости были
-- Vercel Logs (YGPT_USAGE) — просматриваемые вручную, не агрегируемые
-- SQL-запросом, без привязки к конкретному психологу/запросу. Эта
-- таблица даёт возможность в будущем считать не только "цена за
-- запрос", но и "цена за успешно решённую задачу психолога" —
-- workflow_success привязывает стоимость к тому, дошёл ли запрос до
-- полезного результата, а не только до ответа любой ценой.
--
-- Одна строка = одна LLM-итерация внутри одного запроса к
-- /api/assistant (не одна строка на весь запрос — multi-step вопрос с
-- 3 итерациями агентского цикла даст 3 строки с одним и тем же
-- request_id, что позволяет считать и "цена за итерацию", и через
-- group by request_id — "цена за весь запрос психолога").
--
-- Применять через Supabase SQL Editor. Идемпотентно.
-- ============================================================

create table if not exists llm_usage_log (
  id uuid primary key default gen_random_uuid(),

  -- Группировка строк одного запроса психолога (может быть несколько
  -- LLM-итераций на один request_id, см. комментарий выше).
  request_id uuid not null,
  psychologist_id uuid references psychologists(id) on delete set null,

  -- Классификация запроса — для будущего анализа "какие типы вопросов
  -- реально дороже". route соответствует делению в modelSelection.ts
  -- (isReferenceOnlyQuestion) — 'reference' | 'agentic'. domain
  -- зарезервирован на случай будущего разделения по темам (сейчас не
  -- заполняется, т.к. domain routing отменён как отдельная фича).
  route text,
  domain text,
  -- risk_level зарезервирован под будущую классификацию (например,
  -- write-действия vs read-only) — сейчас не заполняется автоматически.
  risk_level text,

  model text not null,

  -- Токены по типам — раздельно, а не только totalTokens, чтобов
  -- будущем анализе было видно ЧТО именно занимает промпт (схема
  -- инструментов против истории диалога против RAG-контекста), а не
  -- только общую цифру. schema_tokens/rag_tokens/history_tokens
  -- заполняются оценочно на прикладной стороне (route.ts), не приходят
  -- от API как отдельные поля — YandexGPT возвращает только
  -- inputTextTokens/completionTokens/totalTokens одной цифрой на весь
  -- промпт.
  input_tokens int,
  output_tokens int,
  schema_tokens int,
  rag_tokens int,
  history_tokens int,
  total_tokens int,

  -- Количество LLM-вызовов и tool-вызовов за ВЕСЬ request_id (не за эту
  -- строку) — дублируется на каждой строке одного request_id для
  -- удобства агрегации без дополнительного join.
  llm_calls_count int,
  tool_calls_count int,
  retries_count int not null default 0,

  -- 'hit' | 'miss' | 'not_applicable' — семантический кэш
  -- (referenceAnswerCache.ts) применяется только к reference-вопросам,
  -- для остальных всегда 'not_applicable'.
  cache_status text,

  -- Оценочная стоимость в рублях по актуальному прайсу на момент
  -- записи (не пересчитывается ретроактивно при смене тарифов).
  cost_rub numeric(10, 4),

  -- Дошёл ли ЗАПРОС (не эта отдельная итерация) до полезного
  -- результата психологу — финальный текстовый ответ без ошибки,
  -- confirmation_required или honest "не удалось обработать" тоже
  -- считаются success (психолог получил осмысленную реакцию), а вот
  -- HTTP-ошибка (502/500) или незамеченная утечка — нет. Заполняется
  -- один раз на request_id (на последней строке итерации).
  workflow_success boolean,

  created_at timestamptz not null default now()
);

create index if not exists llm_usage_log_request_id_idx on llm_usage_log (request_id);
create index if not exists llm_usage_log_psychologist_id_idx on llm_usage_log (psychologist_id);
create index if not exists llm_usage_log_created_at_idx on llm_usage_log (created_at);

-- RLS: включаем, но с политикой только для service-role — эта таблица
-- содержит агрегированную аналитику по всем психологам сразу
-- (аналогично duration/usage-статистике в других SaaS), не персональные
-- данные конкретного психолога, которые он должен видеть в своём
-- кабинете. Обычный психолог никогда не должен читать чужую телеметрию
-- напрямую через Supabase-клиент, поэтому RLS без permissive policy
-- для authenticated фактически запрещает доступ всем, кроме
-- service-role (который используется в скриптах биллинг-анализа).
alter table llm_usage_log enable row level security;
