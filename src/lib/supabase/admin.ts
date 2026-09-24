import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase-клиент с service role key — обходит RLS.
 *
 * Используется там, где запрос не приходит от залогиненного психолога
 * через cookie-сессию, а от внешней системы: webhook'и Telegram/VK
 * (/api/webhooks/*). Эти запросы физически не могут пройти обычную
 * сессионную авторизацию — Telegram не знает про auth.uid() психолога,
 * поэтому webhook сам находит нужного психолога по бот-токену/group_id
 * из тела запроса и дальше работает с БД от имени системы, а не
 * пользователя.
 *
 * ЕДИНСТВЕННОЕ ДОПОЛНИТЕЛЬНОЕ ИСКЛЮЧЕНИЕ (24.09.2026, по прямому
 * решению пользователя): .../recording/chunks/authorize/route.ts —
 * ТОЛЬКО для самого вызова createSignedUploadUrl(), И ТОЛЬКО ПОСЛЕ
 * того, как этот же route уже проверил владение сессией через
 * обычный cookie-based createClient() (см. ./server.ts). Причина:
 * RLS-политики own_session_recordings_insert/update на storage.objects
 * (migration_037) сейчас разрешают психологу-владельцу писать/
 * перезаписывать ЛЮБОЙ объект в recordings/{session_id}/** напрямую
 * через СВОЙ браузерный клиент, в обход authorize вообще — это
 * отдельно задокументированный и пока НЕ закрытый риск (см. часть 2
 * migration_038_recording_attempt_id.sql, не применена). Перевод
 * authorize-route на этот admin-клиент для выдачи токена — не
 * решает эту проблему сам по себе (она в самих политиках), но
 * является ПРЕДПОСЫЛКОЙ для будущего закрытия: когда политики
 * authenticated на этом бакете будут убраны, только этот route
 * (единственный держатель service-role в данном потоке) сможет
 * продолжать выдавать подписанные токены.
 *
 * Не использовать больше нигде в обычных route handlers, доступных
 * из браузера — там нужен createClient() из ./server.ts, чтобы RLS
 * ограничивал данные текущим психологом.
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
