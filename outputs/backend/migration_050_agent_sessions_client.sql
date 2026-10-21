-- 050: история ассистента привязана к клиенту (у каждого клиента свой чат).
-- Старые сессии остаются с client_id = NULL и показываются в общем чате ассистента.
ALTER TABLE public.agent_sessions
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS agent_sessions_psychologist_client_idx
  ON public.agent_sessions (psychologist_id, client_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
