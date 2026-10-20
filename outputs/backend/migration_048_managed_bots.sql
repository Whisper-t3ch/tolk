-- Автосоздание Telegram-ботов психологов через Managed Bots (платформенный бот — менеджер).
-- Запрос на создание: психолог получает ссылку t.me/newbot/<менеджер>/<username>; когда подтвердит создание,
-- менеджер получает update managed_bot, забирает токен и подключает бота. Таблица — только для service role.

create table if not exists public.managed_bot_requests (
  id                 uuid primary key default gen_random_uuid(),
  psychologist_id    uuid not null,
  suggested_username text not null,
  status             text not null default 'pending',   -- pending | done | error
  bot_username       text,
  error              text,
  created_at         timestamptz not null default now(),
  done_at            timestamptz
);
create index if not exists managed_bot_requests_username_idx on public.managed_bot_requests (lower(suggested_username));
create index if not exists managed_bot_requests_psy_idx on public.managed_bot_requests (psychologist_id, created_at desc);
alter table public.managed_bot_requests enable row level security;

notify pgrst, 'reload schema';
