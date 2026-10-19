-- 045: Telegram-уведомления психологам через платформенного бота + ответы поддержки.
-- Применять: sudo docker exec -i supabase-db psql -U supabase_admin -d postgres < migration_045_...sql

-- Привязка Telegram-чата пользователя к аккаунту (один чат на пользователя и канал).
CREATE TABLE IF NOT EXISTS notification_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'telegram' CHECK (channel IN ('telegram')),
  chat_id text NOT NULL,
  username text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel)
);
ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_channels_owner_select ON notification_channels;
CREATE POLICY notification_channels_owner_select ON notification_channels
  FOR SELECT USING (user_id = auth.uid());
GRANT SELECT ON notification_channels TO authenticated;
GRANT ALL ON notification_channels TO service_role;

-- Одноразовые токены привязки (deep link t.me/<bot>?start=<token>). Только service_role.
CREATE TABLE IF NOT EXISTS notification_link_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
ALTER TABLE notification_link_tokens ENABLE ROW LEVEL SECURITY;
GRANT ALL ON notification_link_tokens TO service_role;

-- Ответы поддержки на обращения.
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS reply text;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS replied_at timestamptz;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS short_id text GENERATED ALWAYS AS (left(id::text, 8)) STORED;
CREATE INDEX IF NOT EXISTS support_tickets_short_id_idx ON support_tickets (short_id);

NOTIFY pgrst, 'reload schema';
