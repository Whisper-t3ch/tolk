-- ============================================================
-- ТОЛК — миграция 005: интеграции с мессенджерами (Telegram, VK)
-- ============================================================
-- Контекст: в migration_004 таблица messages создавалась с
-- channel check ('telegram','vk','max') и status ('pending','sent',
-- 'failed') — на тот момент интеграций ещё не было, все сообщения
-- сохранялись как 'pending' без реальной отправки.
--
-- Эта миграция добавляет реальную инфраструктуру отправки/приёма:
--   - messenger_integrations: токены ботов на психолога
--   - client_messenger_links: связь клиента с его чатом в мессенджере
--   - messages: расширяется полями direction/external_message_id,
--     статус 'delivered' добавляется в допустимые значения
--
-- MAX не подключаем (пользователь отказался от площадки) — канал
-- 'max' в check-constraint оставлен для обратной совместимости со
-- старыми записями, но новый код его не использует.

-- ------------------------------------------------------------
-- messenger_integrations — учётные данные ботов психолога
-- ------------------------------------------------------------
create table if not exists messenger_integrations (
  id uuid primary key default gen_random_uuid(),
  psychologist_id uuid not null references psychologists(id) on delete cascade,
  platform text not null check (platform in ('telegram', 'vk')),
  -- Telegram: bot_token (от @BotFather). VK: group_access_token + group_id.
  bot_token text,
  vk_group_id text,
  -- VK при подключении Callback API выдаёт одноразовый код подтверждения,
  -- который нужно вернуть на type:'confirmation' — психолог вводит его
  -- при настройке интеграции, храним, чтобы webhook мог ответить в любой момент.
  confirmation_code text,
  -- Секрет для валидации входящих webhook-запросов (проверка подписи/токена).
  webhook_secret text not null default encode(gen_random_bytes(24), 'hex'),
  bot_username text,
  status text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  last_error text,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(psychologist_id, platform)
);

create trigger trg_messenger_integrations_updated_at before update on messenger_integrations
  for each row execute function set_updated_at();

create index if not exists idx_messenger_integrations_psychologist
  on messenger_integrations(psychologist_id);

-- ------------------------------------------------------------
-- client_messenger_links — связь клиента с его чатом в конкретном
-- мессенджере. Заполняется при первом входящем сообщении от
-- клиента (по ссылке-приглашению с client_id в start-параметре)
-- либо вручную психологом.
-- ------------------------------------------------------------
create table if not exists client_messenger_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  psychologist_id uuid not null references psychologists(id) on delete cascade,
  platform text not null check (platform in ('telegram', 'vk')),
  -- Telegram: chat_id (число, строкой). VK: peer_id/user_id (строкой).
  external_chat_id text not null,
  external_username text,
  linked_at timestamptz not null default now(),
  unique(psychologist_id, platform, external_chat_id)
);

create index if not exists idx_client_messenger_links_client on client_messenger_links(client_id);
create index if not exists idx_client_messenger_links_lookup
  on client_messenger_links(psychologist_id, platform, external_chat_id);

-- ------------------------------------------------------------
-- messages — расширение под реальную отправку/приём
-- ------------------------------------------------------------
alter table messages
  add column if not exists external_message_id text,
  add column if not exists error_message text;

-- 'delivered' добавляется как допустимый статус (webhook-подтверждение
-- доставки, если платформа его присылает); 'max' остаётся в списке
-- каналов для совместимости со старыми записями, но не используется.
alter table messages drop constraint if exists messages_status_check;
alter table messages add constraint messages_status_check
  check (status in ('pending', 'sent', 'delivered', 'failed'));

create index if not exists idx_messages_channel_status on messages(channel, status);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table messenger_integrations enable row level security;
alter table client_messenger_links enable row level security;

create policy "own_messenger_integrations" on messenger_integrations
  for all using (psychologist_id = auth.uid());
create policy "own_client_messenger_links" on client_messenger_links
  for all using (psychologist_id = auth.uid());

-- Примечание: webhook-роуты (/api/webhooks/telegram, /api/webhooks/vk)
-- принимают запросы от Telegram/VK, а не от залогиненного психолога,
-- поэтому обращаются к БД через service role key (обходит RLS),
-- а не через обычный клиент с сессией пользователя.
