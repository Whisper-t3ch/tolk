-- ============================================================
-- migration_034_session_transcript_chunks.sql
--
-- КРИТИЧНЫЙ ФИКС: search_client_history не находил вообще ничего
-- на реальных часовых сессиях. Причина — session_transcripts.embedding
-- считался через yandexGptEmbed(raw_text целиком) одним вызовом, а
-- лимит YandexGPT Embeddings — 2048 токенов на вход (официальная
-- документация: https://aistudio.yandex.ru/ru/docs/ai-studio/concepts/limits).
-- Реальная часовая сессия анонимизированного текста — обычно
-- 3-6 тысяч токенов, то есть ЛЮБАЯ нормальная сессия превышала лимит
-- и embedding падал с ошибкой 400 — session_transcripts.embedding
-- оставался NULL, match_session_transcripts эту строку никогда не
-- находил (см. `and st.embedding is not null` в migration_004_agent.sql).
--
-- Обнаружено 20.09 при тестировании клиента с 10 сессиями (~9-17 тыс.
-- символов на сессию) — 10 из 10 embedding-вызовов упали с 400. Не
-- всплывало раньше, потому что тестовые клиенты (Марина/Ольга) имели
-- только 1-2 короткие тестовые сессии, случайно уместившиеся в лимит.
--
-- Решение — чанкинг: текст сессии режется на части ~4000 символов
-- (эмпирический запас под 2048 токенов для кириллицы, ~2.5 символа на
-- токен) с перекрытием, чтобы не рвать мысль ровно на границе. Каждый
-- чанк получает свой embedding и хранится отдельной строкой.
-- session_transcripts.embedding (на всю сессию) и raw_text не убираем —
-- raw_text по-прежнему нужен для SOAP/summary (там генеративная модель
-- с гораздо большим окном, лимит 2048 токенов её не касается),
-- embedding на уровне сессии просто перестаёт использоваться поиском
-- и остаётся NULL — не мешает.
-- ============================================================

create table if not exists session_transcript_chunks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  chunk_index int not null,
  chunk_text text not null,
  embedding vector(256),
  created_at timestamptz not null default now(),
  unique (session_id, chunk_index)
);

create index if not exists idx_session_transcript_chunks_session
  on session_transcript_chunks(session_id);

create index if not exists idx_session_transcript_chunks_embedding
  on session_transcript_chunks using hnsw (embedding vector_cosine_ops);

alter table session_transcript_chunks enable row level security;

-- Тот же паттерн, что и у остальных таблиц с данными клиента — доступ
-- через JOIN до sessions.psychologist_id, а не собственную колонку
-- psychologist_id (чанки физически принадлежат сессии, дублировать
-- psychologist_id сюда было бы избыточной денормализацией без пользы).
create policy "own_transcript_chunks_select" on session_transcript_chunks
  for select using (
    exists (
      select 1 from sessions s
      where s.id = session_transcript_chunks.session_id
        and s.psychologist_id = auth.uid()
    )
  );

create policy "own_transcript_chunks_insert" on session_transcript_chunks
  for insert with check (
    exists (
      select 1 from sessions s
      where s.id = session_transcript_chunks.session_id
        and s.psychologist_id = auth.uid()
    )
  );

create policy "own_transcript_chunks_delete" on session_transcript_chunks
  for delete using (
    exists (
      select 1 from sessions s
      where s.id = session_transcript_chunks.session_id
        and s.psychologist_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- RPC для similarity search по чанкам — замена match_session_transcripts
-- в executor.ts::searchClientHistory. Возвращает чанки (не целые
-- сессии), поэтому одна сессия может встретиться несколько раз в
-- результатах, если совпало несколько её чанков — вызывающий код
-- сам решает, схлопывать ли по session_id или показывать как есть.
-- ------------------------------------------------------------
create or replace function match_session_transcript_chunks(
  query_embedding vector(256),
  match_client_id uuid,
  match_psychologist_id uuid,
  match_count int default 5
)
returns table (
  session_id uuid,
  chunk_text text,
  similarity float,
  scheduled_at timestamptz
)
language sql stable
as $$
  select
    stc.session_id,
    stc.chunk_text,
    1 - (stc.embedding <=> query_embedding) as similarity,
    s.scheduled_at
  from session_transcript_chunks stc
  join sessions s on s.id = stc.session_id
  where s.client_id = match_client_id
    and s.psychologist_id = match_psychologist_id
    and stc.embedding is not null
  order by stc.embedding <=> query_embedding
  limit match_count;
$$;
