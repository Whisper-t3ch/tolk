import type { SupabaseClient } from "@supabase/supabase-js";

// src/lib/maintenance.ts
//
// Единая точка чтения флага "идут технические работы с записью"
// (public.app_maintenance_flags, migration_040_recording_maintenance_flag.sql).
// Один флаг на всё приложение (key='recording_writes') — читается из
// каждого write-пути к recording_attempts/session_recording_chunks:
//   - POST .../recording/attempts
//   - POST .../recording/chunks/authorize
//   - POST .../recording/chunks (confirm)
//   - POST .../recording/manifest
// а также из GET .../soap — для баннера на странице звонка (см.
// session/[id]/page.tsx), чтобы вообще не монтировать JitsiCallView в
// момент технических работ, а не просто ловить 503 внутри recorder'а.
//
// Пользовательский текст ниже — фиксированная строка в коде, НЕ
// значение из БД: колонка message в таблице предназначена для
// внутренних заметок оператора (authenticated к ней доступа не имеет,
// см. migration_040) и никогда не должна становиться каналом показа
// произвольного текста пользователю.
//
// Принимает уже созданный клиент вызывающего route (createClient() из
// @/lib/supabase/server) — отдельного admin/service-role клиента не
// требует: RLS-политика на флаге не завязана на владение (using(true)
// для роли authenticated), а GRANT ограничен колонками (key, enabled).
export const RECORDING_MAINTENANCE_MESSAGE =
  "Ведутся технические работы с записью консультаций. Повторите попытку через несколько минут.";

/**
 * true — новые попытки записи/фрагменты/manifest временно
 * останавливаются на уровне приложения (используется во время
 * production cutover-окна, см. рантбук Фазы 2 — замена constraint на
 * session_recording_chunks). false — обычная работа, поведение не
 * меняется вообще.
 *
 * Fail-open осознанно: если сам флаг недоступен (сетевая ошибка,
 * миграция 040 ещё не применена на этом окружении) — НЕ блокируем
 * обычную запись из-за инфраструктурной проблемы с самим
 * переключателем. Единственное место, где это имеет значение — сам
 * cutover, и рантбук отдельным шагом проверяет ПОСЛЕ включения флага,
 * что запись реально остановилась (count(*) перестал расти), а не
 * полагается на одно только "функция вернула true".
 */
export async function isRecordingMaintenanceOn(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase
    .from("app_maintenance_flags")
    .select("enabled")
    .eq("key", "recording_writes")
    .maybeSingle();

  if (error) {
    console.error(`[maintenance] не удалось прочитать флаг recording_writes: ${error.message}`);
    return false;
  }
  return data?.enabled === true;
}
