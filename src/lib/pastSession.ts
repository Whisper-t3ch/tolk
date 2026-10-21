import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTimeZone, todayInTimeZone, zonedDateTimeToUtc } from "@/lib/timezone";

/**
 * Момент «прошедшей» встречи по календарной дате: полдень по поясу психолога, но не позже чем 2 часа назад
 * (иначе платформа считала бы загруженную встречу предстоящей). Без даты — 2 часа назад.
 * Возвращает ISO-строку или текст ошибки для психолога.
 */
export async function pastSessionMoment(
  supabase: SupabaseClient,
  psychologistId: string,
  date: string | null | undefined
): Promise<{ ok: true; scheduledAt: string } | { ok: false; error: string }> {
  const { data: prof } = await supabase.from("psychologists").select("timezone").eq("id", psychologistId).maybeSingle();
  const timeZone = normalizeTimeZone(prof?.timezone as string | undefined);
  const lastSafeMoment = Date.now() - 2 * 3600_000;
  if (!date) return { ok: true, scheduledAt: new Date(lastSafeMoment).toISOString() };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Некорректная дата (ожидается YYYY-MM-DD)" };
  if (date > todayInTimeZone(timeZone)) return { ok: false, error: "Дата прошедшей встречи не может быть в будущем" };
  const noon = zonedDateTimeToUtc(date, "12:00", timeZone).getTime();
  return { ok: true, scheduledAt: new Date(Math.min(noon, lastSafeMoment)).toISOString() };
}
