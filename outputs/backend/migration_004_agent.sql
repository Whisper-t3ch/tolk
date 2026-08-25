-- ============================================================
-- ТОЛК — миграция 004: AI-агент (function calling, RAG, память)
-- ============================================================
-- ВАЖНО про размерность эмбеддингов:
-- В ТЗ фигурировала vector(1536) — это размерность OpenAI
-- text-embedding-ada-002. У YandexGPT Embeddings (модели
-- text-search-doc / text-search-query, v1) размер вектора — 256,
-- не 1536. Использование vector(1536) при реальных 256-мерных
-- эмбеддингах привело бы к ошибке вставки (pgvector требует
-- точного совпадения размерности). Ниже используется vector(256)
-- согласно официальной документации Yandex Cloud AI Studio:
-- https://aistudio.yandex.ru/docs/en/ai-studio/concepts/embeddings
-- Если позже переключитесь на v2-модели с другой размерностью
-- (128/256/512/768) — колонку нужно будет пересоздать.

create extension if not exists "vector";

-- ------------------------------------------------------------
-- psychologist_preferences — предпочтения психолога
-- (буфер между сессиями, время на дорогу, рабочие часы и т.д.)
-- ------------------------------------------------------------
create table if not exists psychologist_preferences (
  id uuid primary key default gen_random_uuid(),
  psychologist_id uuid not null references psychologists(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  unique(psychologist_id, key)
);

-- Примеры ключей (не enforced на уровне БД, для справки):
-- rest_between_sessions: {"minutes": 15}
-- travel_time: {"to_office": 30, "notes": "пн-ср офис"}
-- preferred_hours: {"start": "10:00", "end": "20:00"}
-- preferred_days: ["mon","tue","wed","thu","fri"]
-- session_duration_default: {"minutes": 60}

-- ------------------------------------------------------------
-- knowledge_base — личная база знаний психолога (техники, статьи,
-- протоколы) для RAG-поиска ассистентом
-- ------------------------------------------------------------
create table if not exists knowledge_base (
  id uuid primary key default gen_random_uuid(),
  psychologist_id uuid not null references psychologists(id) on delete cascade,
  title text,
  content text not null,
  embedding vector(256),
  source_type text check (source_type in ('technique', 'article', 'protocol', 'manual')),
  approach text,
  created_at timestamptz not null default now()
);

create index if not exists idx_knowledge_base_embedding
  on knowledge_base using hnsw (embedding vector_cosine_ops);

-- ------------------------------------------------------------
-- agent_sessions — история диалогов психолога с AI-агентом
-- ------------------------------------------------------------
create table if not exists agent_sessions (
  id uuid primary key default gen_random_uuid(),
  psychologist_id uuid not null references psychologists(id) on delete cascade,
  messages jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_agent_sessions_updated_at before update on agent_sessions
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- messages — исходящие сообщения клиентам (Telegram/VK/MAX).
-- Реальных интеграций с мессенджерами пока нет — записи
-- сохраняются со status='pending', отправка подключается позже.
-- ------------------------------------------------------------
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  psychologist_id uuid not null references psychologists(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  channel text not null check (channel in ('telegram', 'vk', 'max')),
  direction text not null default 'outgoing' check (direction in ('outgoing', 'incoming')),
  kind text not null default 'message' check (kind in ('message', 'homework', 'session_invite')),
  text text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  related_session_id uuid references sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists idx_messages_client on messages(client_id);
create index if not exists idx_messages_psychologist on messages(psychologist_id);

-- ------------------------------------------------------------
-- Эмбеддинги транскриптов сессий (для RAG по истории клиента)
-- ------------------------------------------------------------
alter table session_transcripts
  add column if not exists embedding vector(256);

create index if not exists idx_session_transcripts_embedding
  on session_transcripts using hnsw (embedding vector_cosine_ops);

-- ------------------------------------------------------------
-- RLS на все новые таблицы
-- ------------------------------------------------------------
alter table psychologist_preferences enable row level security;
alter table knowledge_base enable row level security;
alter table agent_sessions enable row level security;
alter table messages enable row level security;

create policy "own_preferences" on psychologist_preferences
  for all using (psychologist_id = auth.uid());
create policy "own_knowledge" on knowledge_base
  for all using (psychologist_id = auth.uid());
create policy "own_agent_sessions" on agent_sessions
  for all using (psychologist_id = auth.uid());
create policy "own_messages" on messages
  for all using (psychologist_id = auth.uid());

-- ------------------------------------------------------------
-- Индексы под частые запросы
-- ------------------------------------------------------------
create index if not exists idx_preferences_psychologist on psychologist_preferences(psychologist_id);
create index if not exists idx_knowledge_base_psychologist on knowledge_base(psychologist_id);
create index if not exists idx_agent_sessions_psychologist on agent_sessions(psychologist_id);

-- ------------------------------------------------------------
-- RPC-функции для similarity search (вызываются через
-- supabase.rpc(...) из src/lib/agent/executor.ts). SECURITY INVOKER
-- (по умолчанию) — выполняются с правами вызывающего, поэтому RLS
-- таблиц session_transcripts/knowledge_base продолжает применяться,
-- отдельно фильтровать по психологу в функции не обязательно, но
-- match_psychologist_id передаётся явно для дополнительной защиты
-- и на случай, если RLS на transcripts не покроет прямой JOIN.
-- ------------------------------------------------------------

create or replace function match_session_transcripts(
  query_embedding vector(256),
  match_client_id uuid,
  match_psychologist_id uuid,
  match_count int default 5
)
returns table (
  session_id uuid,
  raw_text text,
  similarity float,
  scheduled_at timestamptz
)
language sql stable
as $$
  select
    st.session_id,
    st.raw_text,
    1 - (st.embedding <=> query_embedding) as similarity,
    s.scheduled_at
  from session_transcripts st
  join sessions s on s.id = st.session_id
  where s.client_id = match_client_id
    and s.psychologist_id = match_psychologist_id
    and st.embedding is not null
  order by st.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function match_knowledge_base(
  query_embedding vector(256),
  match_psychologist_id uuid,
  match_approach text default null,
  match_count int default 3
)
returns table (
  id uuid,
  title text,
  content text,
  approach text,
  similarity float
)
language sql stable
as $$
  select
    kb.id,
    kb.title,
    kb.content,
    kb.approach,
    1 - (kb.embedding <=> query_embedding) as similarity
  from knowledge_base kb
  where kb.psychologist_id = match_psychologist_id
    and kb.embedding is not null
    and (match_approach is null or kb.approach = match_approach)
  order by kb.embedding <=> query_embedding
  limit match_count;
$$;
