// ============================================================
// Лимиты запросов к ИИ-ассистенту. Серверный код — используется
// только внутри route.ts, требует Supabase-клиент с сессией
// пользователя (для auth.uid()) или service-role клиент, если
// psychologistId уже известен из другого источника.
//
// Любой запрос психолога = 1 из лимита (решение владельца 17.10): число в тарифе
// («60 запросов к ассистенту») должно совпадать с числом вопросов, которые психолог
// реально может задать. Раньше вопрос с инструментами и срез списывали по 3 —
// психолог на «Практике» получал ~20 вопросов вместо обещанных 60. Себестоимость
// запроса на Cloud.ru ~0,3–1,2 ₽ (срез ~1,5–2,5 ₽), так что разницу держим в цене тарифа.
// Не расходуют лимит вообще (вес 0, поэтому просто не вызывают
// checkAssistantLimit/consumeAssistantLimit): загрузка материала в
// базу знаний (/api/knowledge — только эмбеддинги, не чат-генерация),
// автоматическая генерация SOAP-протокола (когда появится).
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";

export const ASSISTANT_REQUEST_COST = {
  normal: 1,
  periodSummary: 1, // периодический срез по клиенту (/api/clients/[id]/summary)
  multiClient: 1, // зарезервировано на будущее
  agentTask: 1, // вопрос, на который ассистент вызывал инструменты (одна цепочка = один запрос)
  rag: 1, // простой RAG-поиск по истории/базе знаний
} as const;

export type AssistantRequestCostKey = keyof typeof ASSISTANT_REQUEST_COST;

// Месячный лимит запросов к ассистенту по тарифу психолога
// (psychologists.plan_name, см. migration_006_plan_limits.sql).
// Лимит намеренно вынесен в код, а не хранится числом в БД — смена
// условий тарифа (например, поднять Профессионал с 200 до 300) это
// правка одной константы, а не миграция данных по всем психологам.
export const PLAN_LIMITS = {
  beta: 200,
  practice: 60,
  professional: 200,
  expert: 600,
  // Тарифы закрытой беты — выдаются инвайт-кодом (migration 052), сами менять нельзя.
  beta_paid: 400, // «платники»: 400 запросов в месяц
  beta_free: 50, // бесплатный пробный: 50 запросов на весь срок доступа (access_expires_at), без месячного сброса
  unlimited: 1_000_000, // владелец / команда: фактически без ограничений
} as const;

export type PlanName = keyof typeof PLAN_LIMITS;

/** Размер одного докупаемого пакета запросов (пока без оплаты — mock). */
export const EXTRA_PACK_SIZE = 100;

/** Тарифы, которые задаются инвайт-кодом: докупка и самостоятельная смена тарифа для них закрыта. */
export const INVITE_PLANS = ["beta_paid", "beta_free", "unlimited"] as const;
export function isInvitePlan(planName: string | null | undefined): boolean {
  return !!planName && (INVITE_PLANS as readonly string[]).includes(planName);
}

/** Тарифы, на которые психолог может переключиться сам (beta — только стартовый). */
export const SWITCHABLE_PLANS = ["practice", "professional", "expert"] as const;

function resolvePlanLimit(planName: string | null | undefined): number {
  if (planName && planName in PLAN_LIMITS) {
    return PLAN_LIMITS[planName as PlanName];
  }
  return PLAN_LIMITS.beta; // консервативный дефолт для неизвестного/пустого значения
}

export interface LimitCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  /** Срок пробного доступа истёк (psychologists.access_expires_at в прошлом). */
  expired: boolean;
  planName: string;
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
  const { used, limit, expired, planName } = await resetIfDue(supabase, psychologistId);
  const costValue = ASSISTANT_REQUEST_COST[cost];
  return {
    allowed: !expired && used + costValue <= limit,
    used,
    limit,
    remaining: expired ? 0 : Math.max(0, limit - used),
    expired,
    planName,
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
): Promise<{ used: number; limit: number; extra: number; expired: boolean; expiresAt: string | null; planName: string }> {
  // select("*"): колонка assistant_extra_requests (migration 044) может
  // отсутствовать, пока миграцию не применили — тогда extra = 0.
  const { data, error } = await supabase
    .from("psychologists")
    .select("*")
    .eq("id", psychologistId)
    .single();
  if (error) throw error;

  const used = (data?.assistant_requests_used as number | null) ?? 0;
  const extra = Math.max(0, (data?.assistant_extra_requests as number | null) ?? 0);
  const planName = (data?.plan_name as string | null) ?? "beta";
  const limit = resolvePlanLimit(planName) + extra;
  const resetAt = data?.assistant_requests_reset_at as string | null;
  // Колонка access_expires_at (migration 052) может отсутствовать — тогда срока нет.
  const expiresAt = (data?.access_expires_at as string | null | undefined) ?? null;
  const expired = !!expiresAt && new Date(expiresAt) <= new Date();

  // Бесплатный пробный тариф: 50 запросов на весь срок доступа, месячного сброса нет
  // (продление — вручную: SQL в OPS.md «Инвайт-коды»).
  if (planName === "beta_free" || !resetAt || new Date(resetAt) > new Date()) {
    return { used, limit, extra, expired, expiresAt, planName };
  }

  const nextReset = new Date();
  nextReset.setUTCMonth(nextReset.getUTCMonth() + 1, 1);
  nextReset.setUTCHours(0, 0, 0, 0);

  const { error: resetError } = await supabase
    .from("psychologists")
    .update({ assistant_requests_used: 0, assistant_requests_reset_at: nextReset.toISOString() })
    .eq("id", psychologistId);
  if (resetError) throw resetError;

  // Докупленные запросы не сгорают при ежемесячном сбросе.
  return { used: 0, limit, extra, expired, expiresAt, planName };
}

/** Докупка пакета запросов (mock-оплата: просто увеличивает лимит). */
export async function addExtraRequests(
  supabase: SupabaseClient,
  psychologistId: string,
  amount: number = EXTRA_PACK_SIZE
): Promise<void> {
  const { data, error } = await supabase
    .from("psychologists")
    .select("*")
    .eq("id", psychologistId)
    .single();
  if (error) throw error;
  const current = Math.max(0, (data?.assistant_extra_requests as number | null) ?? 0);
  const { error: upErr } = await supabase
    .from("psychologists")
    .update({ assistant_extra_requests: current + amount })
    .eq("id", psychologistId);
  if (upErr) throw upErr;
}

export function limitExceededResponse(limit: number, check?: { expired?: boolean; planName?: string }) {
  if (check?.expired) {
    return { error: "Пробный доступ закончился. Напишите в «Помощь» — продлим.", limit, expired: true };
  }
  if (isInvitePlan(check?.planName)) {
    return { error: "Лимит запросов исчерпан. Напишите в «Помощь» — добавим ещё.", limit };
  }
  return {
    error: "Лимит запросов исчерпан. Докупить: +100 за 99 ₽",
    limit,
  };
}

export interface AssistantLimitStatus extends LimitCheckResult {
  planName: PlanName;
  /** Докупленные запросы (уже включены в limit). */
  extra: number;
  /** Когда заканчивается пробный доступ (ISO) или null, если срока нет. */
  expiresAt: string | null;
}

/**
 * Текущее состояние лимита для отображения в UI (счётчик "45 / 200" в
 * /settings) — без списания. Использует ту же логику авто-сброса по
 * дате, что и checkAssistantLimit, поэтому счётчик в UI не "залипает"
 * на старом значении, даже если психолог просто открыл настройки, не
 * сделав ни одного запроса к ассистенту в новом месяце.
 */
export async function getAssistantLimitStatus(
  supabase: SupabaseClient,
  psychologistId: string
): Promise<AssistantLimitStatus> {
  const { data } = await supabase
    .from("psychologists")
    .select("plan_name")
    .eq("id", psychologistId)
    .single();
  const planName = (data?.plan_name as PlanName | null) ?? "beta";

  const { used, limit, extra, expired, expiresAt } = await resetIfDue(supabase, psychologistId);
  return {
    allowed: !expired && used < limit,
    used,
    limit,
    remaining: expired ? 0 : Math.max(0, limit - used),
    planName,
    extra,
    expired,
    expiresAt,
  };
}
