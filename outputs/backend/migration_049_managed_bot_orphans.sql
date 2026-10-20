-- Managed Bots: бот создан через платформенного бота, но ещё не удалось понять, чей он
-- (психолог поменял username в окне Telegram и его Telegram не привязан к аккаунту ТОЛК).
-- Подключится автоматически, когда создатель привяжет Telegram («Профиль» → «Telegram-уведомления»).
-- Токен НЕ хранится: при подключении запрашивается заново через getManagedBotToken.
create table if not exists public.managed_bot_orphans (
  bot_id        bigint primary key,
  bot_username  text not null,
  creator_tg_id bigint,
  created_at    timestamptz not null default now()
);
create index if not exists managed_bot_orphans_creator_idx on public.managed_bot_orphans (creator_tg_id);
alter table public.managed_bot_orphans enable row level security;
notify pgrst, 'reload schema';
