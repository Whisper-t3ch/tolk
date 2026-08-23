// ============================================================
// Клиент YandexGPT Pro (Yandex Foundation Models Text Generation API).
// Серверный код — используется только внутри route.ts (API routes),
// никогда не импортируется в клиентские компоненты (там нет
// YANDEX_GPT_API_KEY, и не должно быть).
//
// Документация: https://yandex.cloud/en/docs/foundation-models/text-generation/api-ref/TextGeneration/completion
// ============================================================

const YANDEX_COMPLETION_URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion";

export interface YandexGptEnvStatus {
  configured: boolean;
  missing: string[];
}

/**
 * Проверяет наличие обязательных env-переменных, не бросая исключение —
 * вызывающий код (route.ts) сам решает, как ответить клиенту (503).
 */
export function checkYandexGptEnv(): YandexGptEnvStatus {
  const missing: string[] = [];
  if (!process.env.YANDEX_GPT_API_KEY) missing.push("YANDEX_GPT_API_KEY");
  if (!process.env.YANDEX_GPT_FOLDER_ID) missing.push("YANDEX_GPT_FOLDER_ID");
  return { configured: missing.length === 0, missing };
}

export interface YandexGptMessage {
  role: "system" | "user" | "assistant";
  text: string;
}

export interface YandexGptCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  /** Требовать валидный JSON-объект в ответе (модель должна быть явно попрошена об этом в промпте). */
  jsonObject?: boolean;
}

export class YandexGptError extends Error {
  constructor(message: string, public status?: number, public details?: unknown) {
    super(message);
    this.name = "YandexGptError";
  }
}

/**
 * Синхронный вызов completion. Бросает YandexGptError при сетевой ошибке
 * или ошибке API — вызывающий код должен обернуть в try/catch.
 */
export async function yandexGptComplete(
  messages: YandexGptMessage[],
  options: YandexGptCompletionOptions = {}
): Promise<string> {
  const apiKey = process.env.YANDEX_GPT_API_KEY;
  const folderId = process.env.YANDEX_GPT_FOLDER_ID;
  if (!apiKey || !folderId) {
    throw new YandexGptError("YandexGPT не настроен — отсутствуют YANDEX_GPT_API_KEY/YANDEX_GPT_FOLDER_ID");
  }

  const body = {
    modelUri: `gpt://${folderId}/yandexgpt/latest`,
    completionOptions: {
      stream: false,
      temperature: options.temperature ?? 0.3,
      maxTokens: String(options.maxTokens ?? 2000),
    },
    messages: messages.map(m => ({ role: m.role, text: m.text })),
    ...(options.jsonObject ? { jsonObject: true } : {}),
  };

  let response: Response;
  try {
    response = await fetch(YANDEX_COMPLETION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Api-Key ${apiKey}`,
        "x-folder-id": folderId,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new YandexGptError(
      `Не удалось связаться с YandexGPT: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (!response.ok) {
    let details: unknown;
    try {
      details = await response.json();
    } catch {
      details = await response.text().catch(() => undefined);
    }
    throw new YandexGptError(`YandexGPT вернул ошибку ${response.status}`, response.status, details);
  }

  const data = await response.json();
  // API оборачивает ответ в { result: {...} } на практике, хотя в схеме документации
  // это не показано явно — поддерживаем оба варианта на случай расхождений.
  const text: string | undefined =
    data?.result?.alternatives?.[0]?.message?.text ?? data?.alternatives?.[0]?.message?.text;
  if (typeof text !== "string") {
    throw new YandexGptError("YandexGPT вернул неожиданный формат ответа", response.status, data);
  }
  return text;
}

/**
 * Вызывает completion с ожиданием строгого JSON-ответа и парсит его.
 * Модель иногда оборачивает JSON в markdown-código блок несмотря на
 * инструкцию не делать этого — здесь это подчищается перед парсингом.
 */
export async function yandexGptCompleteJson<T>(
  messages: YandexGptMessage[],
  options: YandexGptCompletionOptions = {}
): Promise<T> {
  const raw = await yandexGptComplete(messages, { ...options, jsonObject: true });
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new YandexGptError("Не удалось разобрать JSON-ответ YandexGPT", undefined, raw);
  }
}
