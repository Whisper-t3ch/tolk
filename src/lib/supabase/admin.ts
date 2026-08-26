import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase-клиент с service role key — обходит RLS.
 *
 * Используется ТОЛЬКО там, где запрос не приходит от залогиненного
 * психолога через cookie-сессию, а от внешней системы: webhook'и
 * Telegram/VK (/api/webhooks/*). Эти запросы физически не могут
 * пройти обычную сессионную авторизацию — Telegram не знает про
 * auth.uid() психолога, поэтому webhook сам находит нужного
 * психолога по бот-токену/group_id из тела запроса и дальше
 * работает с БД от имени системы, а не пользователя.
 *
 * Не использовать в обычных route handlers, доступных из браузера —
 * там нужен createClient() из ./server.ts, чтобы RLS ограничивал
 * данные текущим психологом.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY должны быть заданы для admin-клиента");
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
