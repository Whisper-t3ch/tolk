// ============================================================
// Полная телеметрия стоимости запросов к ассистенту (задача "рычаг 4",
// 20.09) — пишет в llm_usage_log (migration_032). Одна строка на одну
// LLM-итерацию агентского цикла, сгруппированные по request_id — см.
// комментарий в самой миграции про то, почему не одна строка на весь
// запрос психолога.
//
// Не блокирует ответ психологу — вызывается через waitUntil из
// route.ts (та же схема, что уже применена для
// referenceAnswerCache.ts: на serverless-рантайме Vercel платформа
// вправе оборвать execution context сразу после отправки ответа).
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import type { YandexGptUsage } from "@/lib/yandexgpt";

// Актуальные тарифы YandexGPT (см. yandexgpt.ts::resolveModelName про
// источники имён моделей) — используются только для оценки cost_rub в
// этой таблице, не влияют на реальный биллинг Yandex Cloud. Обновлять
// вручную при смене прайса — сверено с официальной документацией
// 19.09 (см. коммиты того дня).
const PRICE_RUB_PER_1000_TOKENS: Record<string, number> = {
  "yandexgpt/latest": 1.2, // Pro 5 — все категории токенов одинаковы
  "yandexgpt-5.1": 0.8, // Pro 5.1 — все категории токенов одинаковы
  "yandexgpt-lite/latest": 0.2,
};

function estimateCostRub(model: string, totalTokens: number): number | null {
  const pricePerThousand = PRICE_RUB_PER_1000_TOKENS[model];
  if (pricePerThousand === undefined) return null;
  return Math.round((totalTokens / 1000) * pricePerThousand * 10000) / 10000;
}

export interface UsageLogIterationInput {
  requestId: string;
  psychologistId: string;
  route: "reference" | "agentic";
  model: string;
  usage: YandexGptUsage | null;
  llmCallsCount: number;
  toolCallsCount: number;
  retriesCount: number;
  cacheStatus: "hit" | "miss" | "not_applicable";
  workflowSuccess: boolean | null;
}

/**
 * Записывает одну строку телеметрии. Ошибки записи не должны ронять
 * основной ответ психологу — вызывающий код оборачивает это в
 * waitUntil и здесь же глушит исключения с логированием, как и в
 * остальных fire-and-forget записях этого проекта (см.
 * referenceAnswerCache.ts).
 */
export async function logLlmUsage(supabase: SupabaseClient, input: UsageLogIterationInput): Promise<void> {
  try {
    const totalTokens = input.usage?.totalTokens ?? null;
    const { error } = await supabase.from("llm_usage_log").insert({
      request_id: input.requestId,
      psychologist_id: input.psychologistId,
      route: input.route,
      model: input.model,
      input_tokens: input.usage?.inputTextTokens ?? null,
      output_tokens: input.usage?.completionTokens ?? null,
      total_tokens: totalTokens,
      llm_calls_count: input.llmCallsCount,
      tool_calls_count: input.toolCallsCount,
      retries_count: input.retriesCount,
      cache_status: input.cacheStatus,
      cost_rub: totalTokens !== null ? estimateCostRub(input.model, totalTokens) : null,
      workflow_success: input.workflowSuccess,
    });
    if (error) {
      console.error("usageLog: не удалось записать llm_usage_log", error.message);
    }
  } catch (e) {
    console.error("usageLog: исключение при записи llm_usage_log", e instanceof Error ? e.message : String(e));
  }
}
