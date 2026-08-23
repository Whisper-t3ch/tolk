// ============================================================
// Лимиты запросов к ИИ-ассистенту. Серверный код — используется
// только внутри route.ts, требует Supabase-клиент с сессией
// пользователя (для auth.uid()) или service-role клиент, если
// psychologistId уже известен из другого источника.
//
// Обычный запрос = 1 из лимита.
// Периодический срез (несколько сессий) = 3 из лимита ("тяжёлый").
// Мультиклиентный анализ (когда добавим) = 5 из лимита.
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";

export const ASSISTANT_REQUEST_COST = {
  normal: 1,
  heavy: 3, // периодический срез по клиенту
  multiClient: 5, // зарезервировано на будущее
} as const;

export type AssistantRequestCostKey = keyof typeof ASSISTANT_REQUEST_COST;

export interface LimitCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
}

/**
 * Проверяет, укладывается ли психолог в месячный лимит запросов к
 * ассистенту, не списывая лимит. Если reset-дата уже прошла, лимит
 * считается сброшенным на этот запрос (реальный сброс used=0 в БД
 * происходит в resetIfDue при первом же обращении — см. ниже),
 * чтобы не зависеть от cron-задачи для корректности проверки.
 */
export async function checkAssistantLimit(
  supabase: SupabaseClient,
  psychologistId: string,
  cost: AssistantRequestCostKey = "normal"
): Promise<LimitCheckResult> {
  const { used, limit } = await resetIfDue(supabase, psychologistId);
  const costValue = ASSISTANT_REQUEST_COST[cost];
  return {
    allowed: used + costValue <= limit,
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

/**
 * Списывает лимит после успешного выполнения запроса к ассистенту.
 * Вызывать ПОСЛЕ успешного вызова YandexGPT, не до — чтобы неудачный
 * вызов (ошибка сети/API) не тратил лимит психолога.
 */
export async function consumeAssistantLimit(
  supabase: SupabaseClient,
  psychologistId: string,
  cost: AssistantRequestCostKey = "normal"
): Promise<void> {
  const costValue = ASSISTANT_REQUEST_COST[cost];
  const { data, error } = await supabase
    .from("psychologists")
    .select("assistant_requests_used")
    .eq("id", psychologistId)
    .single();
  if (error) throw error;

  const currentUsed = (data?.assistant_requests_used as number | null) ?? 0;
  const { error: updateError } = await supabase
    .from("psychologists")
    .update({ assistant_requests_used: currentUsed + costValue })
    .eq("id", psychologistId);
  if (updateError) throw updateError;
}

/**
 * Если assistant_requests_reset_at уже в прошлом, обнуляет used и
 * переносит reset_at на начало следующего месяца. Возвращает актуальные
 * used/limit после (возможного) сброса.
 *
 * Это компенсирует отсутствие гарантированной cron-задачи — реальный
 * ежемесячный сброс для АКТИВНЫХ психологов происходит на их первом
 * запросе после наступления даты сброса. Психологи, которые не
 * заходили месяцами, увидят актуальный (сброшенный) лимит при
 * следующем визите — это приемлемо, т.к. cron (n8n / Supabase Edge
 * Function) всё равно рекомендуется добавить отдельно для полной
 * консистентности отображения "сколько до сброса" в UI без запроса.
 */
async function resetIfDue(
  supabase: SupabaseClient,
  psychologistId: string
): Promise<{ used: number; limit: number }> {
  const { data, error } = await supabase
    .from("psychologists")
    .select("assistant_requests_used, assistant_requests_limit, assistant_requests_reset_at")
    .eq("id", psychologistId)
    .single();
  if (error) throw error;

  const used = (data?.assistant_requests_used as number | null) ?? 0;
  const limit = (data?.assistant_requests_limit as number | null) ?? 60;
  const resetAt = data?.assistant_requests_reset_at as string | null;

  if (!resetAt || new Date(resetAt) > new Date()) {
    return { used, limit };
  }

  const nextReset = new Date();
  nextReset.setUTCMonth(nextReset.getUTCMonth() + 1, 1);
  nextReset.setUTCHours(0, 0, 0, 0);

  const { error: resetError } = await supabase
    .from("psychologists")
    .update({ assistant_requests_used: 0, assistant_requests_reset_at: nextReset.toISOString() })
    .eq("id", psychologistId);
  if (resetError) throw resetError;

  return { used: 0, limit };
}

export function limitExceededResponse(limit: number) {
  return {
    error: "Лимит запросов исчерпан. Докупить: +100 за 99 ₽",
    limit,
  };
}
