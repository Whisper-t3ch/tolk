-- ============================================================
-- migration_031_reference_answer_cache.sql
--
-- Семантический кэш ответов на справочные вопросы о платформе
-- (см. src/lib/agent/referenceAnswerCache.ts). Работает ТОЛЬКО для
-- вопросов, которые isReferenceOnlyQuestion() уже классифицировал
-- как не относящиеся к данным конкретного клиента — кэш ОБЩИЙ для
-- всех психологов (не per-psychologist), поэтому нет ни RLS,
-- ограничивающего по auth.uid(), ни psychologist_id в таблице:
-- "где найти шаблоны протоколов" — один и тот же вопрос и один и
-- тот же правильный ответ для любого психолога на платформе.
--
-- Экономика: попадание в кэш экономит не на цене токена (кэш
-- YandexGPT стоит СТОЛЬКО ЖЕ за токен, что и обычные входящие —
-- подтверждено официальным прайсом 17.09), а на том что при
-- совпадении вопрос вообще не уходит в LLM — токены не тратятся
-- никакой категории.
--
-- vector(256) — та же размерность, что и knowledge_base.embedding
-- (migration_004_agent.sql), т.к. используется тот же embedding API
-- (text-search-doc/query, модель Яндекса).
--
-- Применять через Supabase SQL Editor. Идемпотентно.
-- ============================================================

create table if not exists reference_answer_cache (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  question_embedding vector(256),
  answer text not null,
  hit_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reference_answer_cache_embedding_idx
  on reference_answer_cache using ivfflat (question_embedding vector_cosine_ops)
  with (lists = 100);

-- RLS сознательно НЕ включается: таблица не содержит персональных
-- данных клиентов психологов (только вопросы о самой платформе и
-- ответы на них — тот же уровень чувствительности, что у
-- knowledge_base с topic='platform'), и доступ к ней нужен из
-- серверного route.ts через обычный (не service-role) supabase-клиент
-- любого залогиненного психолога, который тем самым читает и пишет
-- ОБЩИЙ, а не свой личный кэш.

create or replace function match_reference_answer_cache(
  query_embedding vector(256),
  match_threshold float default 0.93
)
returns table (
  id uuid,
  answer text,
  similarity float
)
language sql stable
as $$
  select
    rac.id,
    rac.answer,
    1 - (rac.question_embedding <=> query_embedding) as similarity
  from reference_answer_cache rac
  where rac.question_embedding is not null
    and 1 - (rac.question_embedding <=> query_embedding) >= match_threshold
  order by rac.question_embedding <=> query_embedding
  limit 1;
$$;

create or replace function increment_reference_answer_cache_hit(cache_id uuid)
returns void
language sql
as $$
  update reference_answer_cache
  set hit_count = hit_count + 1, updated_at = now()
  where id = cache_id;
$$;
