-- ============================================================
-- migration_042_session_invites.sql
--
-- Этап 3.7 (02.10.2026): client invite flow — одноразовая ссылка,
-- по которой клиент (у которого нет и не будет аккаунта в системе)
-- заходит на консультацию. См. src/lib/invites/sessionInvites.ts.
--
-- Ключевые решения:
--   * Хранится ТОЛЬКО sha256-хеш токена (token_hash), не сам токен —
--     тот же принцип, что у паролей: утечка строки из БД не даёт
--     восстановить рабочую ссылку. Сырой токен отдаётся психологу
--     РОВНО ОДИН РАЗ, в момент создания (ответ POST .../invite), и
--     больше никогда не хранится и не логируется.
--   * session_id в этой таблице — ЕДИНСТВЕННЫЙ источник привязки
--     токена к сессии. /join/<token> не принимает session_id как
--     отдельный параметр ни в URL, ни в теле — поэтому "подмена
--     session_id" структурно невозможна: его неоткуда взять, кроме
--     как из серверной записи по хешу токена.
--   * status + expires_at дают три причины отказа клиенту (истёк /
--     отозван / уже использован) — вместо одного общего "неверная
--     ссылка", что важно для честной диагностики на экране согласия.
--
-- НЕ ПРИМЕНЕНО К ПРОД-БД — только к тестовому Supabase-проекту, тем
-- же протоколом, что и предыдущие миграции.
-- ============================================================

create table if not exists public.session_invites (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  -- sha256(raw_token) в hex — см. src/lib/invites/inviteTokens.ts.
  -- unique: коллизия здесь означала бы два разных сырых токена с
  -- одинаковым хешем (криптографически исключено) либо повторную
  -- генерацию — в обоих случаях это ошибка, а не нормальный путь.
  token_hash text not null unique,
  status text not null default 'active' check (status in ('active', 'revoked', 'used')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists session_invites_session_idx on public.session_invites(session_id);
create index if not exists session_invites_token_hash_idx on public.session_invites(token_hash);

alter table public.session_invites enable row level security;
-- Намеренно НЕТ политик для role authenticated — тот же паттерн, что у
-- recording_jobs (migration_041): создание/отзыв идут через API-роут
-- после проверки владения сессией обычным cookie-клиентом, а сама
-- запись — через service-role; резолюция по токену (/join/<token>)
-- вызывается АНОНИМНЫМ клиентом без какой-либо auth.uid() вообще — ей
-- RLS-политика "владелец сессии" и не могла бы помочь, доступ там
-- контролируется исключительно знанием правильного токена, не ролью.

-- ------------------------------------------------------------
-- Проверки после применения (выполнить вручную):
--
-- select table_name from information_schema.tables
--   where table_schema='public' and table_name='session_invites';
-- ------------------------------------------------------------
