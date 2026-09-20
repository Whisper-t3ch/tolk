// ============================================================
// Клиент YandexGPT (Yandex Foundation Models Text Generation +
// Embeddings API). Серверный код — используется только внутри
// route.ts (API routes), никогда не импортируется в клиентские
// компоненты (там нет YANDEX_GPT_API_KEY, и не должно быть).
//
// Документация:
// - Completion: https://aistudio.yandex.ru/docs/en/ai-studio/text-generation/api-ref/TextGeneration/completion
// - Function calling: https://aistudio.yandex.ru/docs/en/ai-studio/operations/generation/function-call
// - Embeddings: https://aistudio.yandex.ru/docs/en/ai-studio/concepts/embeddings
//
// ВАЖНО про эмбеддинги: размерность вектора YandexGPT Embeddings
// (модели text-search-doc / text-search-query, v1) — 256, а не
// 1536 (это размерность OpenAI ada-002, с ней не путать). Схема
// БД (migration_004_agent.sql) использует vector(256).
// ============================================================

const YANDEX_COMPLETION_URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion";
const YANDEX_EMBEDDING_URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding";

// Асинхронный режим — отдельный эндпоинт (documented: aistudio.yandex.ru/docs/ru/ai-studio/operations/generation/async-request).
// Дешевле синхронного примерно в 2 раза (см. pricing: sync 1.2₽/1000 вход+исход
// для Pro, async 0.61₽/1000 вход+исход) ценой задержки от нескольких минут до
// нескольких часов вместо мгновенного ответа. Подходит для несрочных задач —
// SOAP-протокол генерируется уже ПОСЛЕ завершения сессии, психолог не ждёт
// его в реальном времени.
const YANDEX_COMPLETION_ASYNC_URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/completionAsync";
const YANDEX_OPERATION_URL = "https://operation.api.cloud.yandex.net/operations";

/** Каскад моделей — какую модель использовать для каждого класса задач. */
export type YandexGptModel = "pro" | "lite";

function resolveModelName(model: YandexGptModel): string {
  if (model === "lite") {
    return process.env.YANDEX_GPT_LITE_MODEL || "yandexgpt-lite/latest";
  }
  // ВРЕМЕННО (продолжение сбора паттернов псевдо-tool-call, задача #26,
  // 20.09): Pro 5.1 стабильно ломается на "Что делать если клиент не
  // пришёл на сессию?" — воспроизведено 4 из 4 попыток за два раунда
  // (19.09 и ночь 19→20.09), в минимум двух разных текстовых формах, из
  // которых одна проходит мимо текущего responseGuard.ts. Задача — не
  // включать это в прод навсегда, а спровоцировать модель на широком
  // наборе вопросов и собрать ВСЕ варианты паттерна, чтобы написать
  // надёжный парсер (шаг 2). Единственный пользователь прод-инстанса
  // сейчас — автор, риска для реальных психологов нет. ОБЯЗАТЕЛЬНО
  // вернуть на "yandexgpt/latest" после завершения сбора данных.
  return process.env.YANDEX_GPT_PRO_MODEL || "yandexgpt-5.1";
}

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

/** Сообщение с результатом вызова функции — добавляется в messages после tool_call. */
export interface YandexGptToolResultMessage {
  role: "user";
  toolResultList: {
    toolResults: Array<{
      functionResult: { name: string; content: string };
    }>;
  };
}

/** Сообщение-ассистент с запросом на вызов функции (для истории диалога). */
export interface YandexGptToolCallMessage {
  role: "assistant";
  toolCallList: {
    toolCalls: Array<{
      functionCall: { name: string; arguments: Record<string, unknown> };
    }>;
  };
}

export type YandexGptAnyMessage = YandexGptMessage | YandexGptToolResultMessage | YandexGptToolCallMessage;

/** Описание одного инструмента (функции) для function calling. */
export interface YandexGptTool {
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface YandexGptToolCall {
  functionCall: { name: string; arguments: Record<string, unknown> };
}

export interface YandexGptCompletionOptions {
  model?: YandexGptModel;
  temperature?: number;
  maxTokens?: number;
  /** Требовать валидный JSON-объект в ответе (модель должна быть явно попрошена об этом в промпте). */
  jsonObject?: boolean;
  /** Список инструментов, доступных модели для вызова (function calling). */
  tools?: YandexGptTool[];
}

/** Результат completion-запроса с поддержкой function calling. */
export interface YandexGptCompletionResult {
  /** Текст ответа — заполнен, если модель не запросила вызов функции. */
  text: string | null;
  /** Запрошенные вызовы функций — заполнено, если status = ALTERNATIVE_STATUS_TOOL_CALLS. */
  toolCalls: YandexGptToolCall[] | null;
}

export class YandexGptError extends Error {
  constructor(message: string, public status?: number, public details?: unknown) {
    super(message);
    this.name = "YandexGptError";
  }
}

/**
 * Полный вызов completion с поддержкой function calling. Возвращает либо
 * текст, либо список запрошенных tool_calls — вызывающий код (агентский
 * цикл) сам решает, что делать дальше.
 */
export async function yandexGptCompleteWithTools(
  messages: YandexGptAnyMessage[],
  options: YandexGptCompletionOptions = {}
): Promise<YandexGptCompletionResult> {
  const apiKey = process.env.YANDEX_GPT_API_KEY;
  const folderId = process.env.YANDEX_GPT_FOLDER_ID;
  if (!apiKey || !folderId) {
    throw new YandexGptError("YandexGPT не настроен — отсутствуют YANDEX_GPT_API_KEY/YANDEX_GPT_FOLDER_ID");
  }

  const modelName = resolveModelName(options.model ?? "pro");

  const body = {
    modelUri: `gpt://${folderId}/${modelName}`,
    completionOptions: {
      stream: false,
      temperature: options.temperature ?? 0.3,
      maxTokens: String(options.maxTokens ?? 2000),
    },
    messages,
    ...(options.jsonObject ? { jsonObject: true } : {}),
    ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
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
  const usage = data?.result?.usage ?? data?.usage;
  if (usage) {
    // ВРЕМЕННО (сбор данных для решения о Pro 5.1, см. задачу #26/#35):
    // точные токены из API вместо оценки по размеру текста — грепается
    // в Vercel Logs по маркеру YGPT_USAGE. Формат usage подтверждён
    // документацией Yandex: inputTextTokens/completionTokens/totalTokens.
    console.log("YGPT_USAGE", JSON.stringify({ model: modelName, ...usage }));
  }
  const alternative = data?.result?.alternatives?.[0] ?? data?.alternatives?.[0];
  const toolCalls: YandexGptToolCall[] | undefined = alternative?.message?.toolCallList?.toolCalls;
  if (toolCalls && toolCalls.length > 0) {
    return { text: null, toolCalls };
  }

  const text: string | undefined = alternative?.message?.text;
  if (typeof text !== "string") {
    throw new YandexGptError("YandexGPT вернул неожиданный формат ответа", response.status, data);
  }
  return { text, toolCalls: null };
}

/**
 * Синхронный вызов completion. Бросает YandexGptError при сетевой ошибке
 * или ошибке API — вызывающий код должен обернуть в try/catch.
 * Не поддерживает function calling — для этого используйте yandexGptCompleteWithTools.
 */
export async function yandexGptComplete(
  messages: YandexGptMessage[],
  options: YandexGptCompletionOptions = {}
): Promise<string> {
  const result = await yandexGptCompleteWithTools(messages, options);
  if (result.text === null) {
    throw new YandexGptError("YandexGPT запросил вызов функции, но yandexGptComplete их не поддерживает — используйте yandexGptCompleteWithTools");
  }
  return result.text;
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

/**
 * Запускает completion в АСИНХРОННОМ режиме (см. YANDEX_COMPLETION_ASYNC_URL
 * выше про экономику) и сразу возвращает id операции — не дожидаясь
 * результата. Использовать вместе с yandexGptGetAsyncOperation, который
 * опрашивает статус и возвращает готовый текст, когда генерация завершена.
 *
 * Не поддерживает function calling (агентский цикл требует мгновенного
 * ответа на каждой итерации — async для него не подходит по конструкции).
 * Подходит для одноразовых генераций без немедленной реакции пользователя:
 * сейчас единственный кандидат — SOAP-протокол сессии.
 */
export async function yandexGptStartAsyncCompletion(
  messages: YandexGptMessage[],
  options: YandexGptCompletionOptions = {}
): Promise<string> {
  const apiKey = process.env.YANDEX_GPT_API_KEY;
  const folderId = process.env.YANDEX_GPT_FOLDER_ID;
  if (!apiKey || !folderId) {
    throw new YandexGptError("YandexGPT не настроен — отсутствуют YANDEX_GPT_API_KEY/YANDEX_GPT_FOLDER_ID");
  }

  const modelName = resolveModelName(options.model ?? "pro");

  const body = {
    modelUri: `gpt://${folderId}/${modelName}`,
    completionOptions: {
      stream: false,
      temperature: options.temperature ?? 0.3,
      maxTokens: String(options.maxTokens ?? 2000),
    },
    messages,
    ...(options.jsonObject ? { jsonObject: true } : {}),
  };

  let response: Response;
  try {
    response = await fetch(YANDEX_COMPLETION_ASYNC_URL, {
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
      `Не удалось связаться с YandexGPT (async): ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (!response.ok) {
    let details: unknown;
    try {
      details = await response.json();
    } catch {
      details = await response.text().catch(() => undefined);
    }
    throw new YandexGptError(`YandexGPT (async) вернул ошибку ${response.status}`, response.status, details);
  }

  const data = await response.json();
  const operationId: string | undefined = data?.id;
  if (!operationId) {
    throw new YandexGptError("YandexGPT (async) не вернул id операции", response.status, data);
  }
  return operationId;
}

/** Статус асинхронной операции — done=false означает "ещё генерируется", проверяйте позже. */
export interface YandexGptAsyncOperationStatus {
  done: boolean;
  /** Заполнен только когда done=true и генерация завершилась успешно. */
  text: string | null;
  /** Заполнено, если операция завершилась ошибкой (done=true, но результата нет). */
  error: string | null;
}

/**
 * Проверяет статус операции, запущенной через yandexGptStartAsyncCompletion.
 * Вызывающий код (обычно отдельный API route, опрашиваемый фронтендом с
 * интервалом в несколько секунд) сам решает, как часто опрашивать — эта
 * функция делает ровно один HTTP-запрос за вызов, без встроенного ожидания.
 */
export async function yandexGptGetAsyncOperation(operationId: string): Promise<YandexGptAsyncOperationStatus> {
  const apiKey = process.env.YANDEX_GPT_API_KEY;
  if (!apiKey) {
    throw new YandexGptError("YandexGPT не настроен — отсутствует YANDEX_GPT_API_KEY");
  }

  let response: Response;
  try {
    response = await fetch(`${YANDEX_OPERATION_URL}/${operationId}`, {
      method: "GET",
      headers: { Authorization: `Api-Key ${apiKey}` },
    });
  } catch (e) {
    throw new YandexGptError(
      `Не удалось связаться с Yandex Cloud Operations: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (!response.ok) {
    let details: unknown;
    try {
      details = await response.json();
    } catch {
      details = await response.text().catch(() => undefined);
    }
    throw new YandexGptError(`Yandex Cloud Operations вернул ошибку ${response.status}`, response.status, details);
  }

  const data = await response.json();
  if (!data?.done) {
    return { done: false, text: null, error: null };
  }

  if (data.error) {
    return { done: true, text: null, error: data.error?.message ?? "Операция завершилась ошибкой" };
  }

  const alternative = data?.response?.alternatives?.[0];
  const text: string | undefined = alternative?.message?.text;
  if (typeof text !== "string") {
    return { done: true, text: null, error: "YandexGPT (async) вернул неожиданный формат ответа" };
  }
  return { done: true, text, error: null };
}

/** Тип текста для эмбеддинга — doc (материалы для индексации) или query (поисковый запрос). */
export type YandexEmbeddingTextType = "doc" | "query";

/**
 * Создаёт эмбеддинг текста через YandexGPT Embeddings API. Размерность
 * вектора — 256 (модели text-search-doc / text-search-query, v1).
 * Используйте textType="doc" при индексации материалов (транскрипты,
 * база знаний) и textType="query" при поиске.
 */
export async function yandexGptEmbed(
  text: string,
  textType: YandexEmbeddingTextType = "doc"
): Promise<number[]> {
  const apiKey = process.env.YANDEX_GPT_API_KEY;
  const folderId = process.env.YANDEX_GPT_FOLDER_ID;
  if (!apiKey || !folderId) {
    throw new YandexGptError("YandexGPT не настроен — отсутствуют YANDEX_GPT_API_KEY/YANDEX_GPT_FOLDER_ID");
  }

  const modelSlug =
    textType === "query"
      ? process.env.YANDEX_EMBEDDINGS_MODEL_QUERY || "text-search-query"
      : process.env.YANDEX_EMBEDDINGS_MODEL || "text-search-doc";

  const body = {
    modelUri: `emb://${folderId}/${modelSlug}/latest`,
    text,
  };

  let response: Response;
  try {
    response = await fetch(YANDEX_EMBEDDING_URL, {
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
      `Не удалось связаться с YandexGPT Embeddings: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (!response.ok) {
    let details: unknown;
    try {
      details = await response.json();
    } catch {
      details = await response.text().catch(() => undefined);
    }
    throw new YandexGptError(`YandexGPT Embeddings вернул ошибку ${response.status}`, response.status, details);
  }

  const data = await response.json();
  const embedding: unknown = data?.embedding;
  if (!Array.isArray(embedding)) {
    throw new YandexGptError("YandexGPT Embeddings вернул неожиданный формат ответа", response.status, data);
  }
  return embedding as number[];
}
