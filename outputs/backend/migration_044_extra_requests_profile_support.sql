-- ============================================================
-- Migration 044 (18.10.2026): докупка запросов, профиль, поддержка.
-- Идемпотентна (IF NOT EXISTS). Применять ДО/вместе с деплоем кода.
-- ============================================================

-- 1) Докупленные запросы к ассистенту (не сгорают при ежемесячном сбросе)
ALTER TABLE psychologists ADD COLUMN IF NOT EXISTS assistant_extra_requests integer NOT NULL DEFAULT 0;

-- 2) Кастомизация профиля: фото (уменьшенное, data URL) и «о себе»
ALTER TABLE psychologists ADD COLUMN IF NOT EXISTS avatar_data text;
ALTER TABLE psychologists ADD COLUMN IF NOT EXISTS bio text;

-- 3) Обращения в поддержку
CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  psychologist_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  subject text,
  message text NOT NULL,
  page_url text,
  user_agent text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_tickets_owner_select ON support_tickets;
CREATE POLICY support_tickets_owner_select ON support_tickets
  FOR SELECT USING (psychologist_id = auth.uid());
DROP POLICY IF EXISTS support_tickets_owner_insert ON support_tickets;
CREATE POLICY support_tickets_owner_insert ON support_tickets
  FOR INSERT WITH CHECK (psychologist_id = auth.uid());
CREATE INDEX IF NOT EXISTS support_tickets_created_idx ON support_tickets (created_at DESC);
