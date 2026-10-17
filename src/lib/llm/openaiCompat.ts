// ============================================================
// Провайдер LLM в формате OpenAI Chat Completions (Cloud.ru
// Evolution Foundation Models: GigaChat, DeepSeek, Qwen, GLM и др.).
//
// Включается переменной LLM_PROVIDER=openai_compat. По умолчанию
// (переменная не задана) всё работает через YandexGPT, как раньше.
//
// Внутри приложения сообщения и инструменты по-прежнему в
// «яндексовском» каноническом виде (YandexGptAnyMessage и т.д.), чтобы
// не трогать агентский цикл и 18 потребителей. Здесь они переводятся
// в формат OpenAI и обратно. Ответ приводится к YandexGptCompletionResult.
//
// Env:
//   LLM_BASE_URL    — по умолчанию https://foundation-models.api.cloud.ru/v1
//   LLM_API_KEY     — ключ Cloud.ru (Bearer)
//
// Режим «GigaChat от Сбера» (developers.sber.ru), для тестов на личном доступе:
//   LLM_DIALECT=gigachat       — функции в формате GigaChat (functions/function_call, роль function)
//   LLM_AUTH=gigachat_oauth    — LLM_API_KEY = «Authorization key» из кабинета; access token (30 мин)
//                                получается и обновляется автоматически
//   LLM_OAUTH_SCOPE            — по умолчанию GIGACHAT_API_PERS (физлица; для бизнеса B2B/CORP)
//   LLM_OAUTH_URL              — по умолчанию https://ngw.devices.sberbank.ru:9443/api/v2/oauth
//   LLM_BASE_URL               — по умолчанию в этом режиме https://gigachat.devices.sberbank.ru/api/v1
//   NODE_EXTRA_CA_CERTS        — путь к сертификатам Минцифры (русский корневой + подчинённый)
//   LLM_MODEL_PRO   — модель для сложных задач (точное имя: GET /models)
//   LLM_MODEL_LITE  — модель для простых задач (по умолчанию = PRO)
//   LLM_TIMEOUT_MS  — таймаут запроса, по умолчанию 90000
//
// Эмбеддинги НЕ переключаются: в БД vector(256) от Yandex, другая
// модель даст другой размер → нужна отдельная миграция и переиндексация.
// Асинхронный режим (SOAP) эмулируется в памяти процесса — годится для
// тестов и одного инстанса, для прода нужна очередь (см. план).
// ============================================================

import { randomUUID } from "node:crypto";
import {
  YandexGptError,
  isModerationRefusalText,
  type YandexGptAnyMessage,
  type YandexGptAsyncOperationStatus,
  type YandexGptCompletionOptions,
  type YandexGptCompletionResult,
  type YandexGptMessage,
  type YandexGptToolCall,
  type YandexGptUsage,
} from "../yandexgpt";

const DEFAULT_BASE_URL = "https://foundation-models.api.cloud.ru/v1";

export function isOpenAiCompatProvider(): boolean {
  return (process.env.LLM_PROVIDER || "").toLowerCase() === "openai_compat";
}

export function checkOpenAiCompatEnv(): { configured: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.LLM_API_KEY) missing.push("LLM_API_KEY");
  if (!process.env.LLM_MODEL_PRO) missing.push("LLM_MODEL_PRO");
  return { configured: missing.length === 0, missing };
}

const GIGACHAT_BASE_URL = "https://gigachat.devices.sberbank.ru/api/v1";
const GIGACHAT_OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";

export function isGigaChatDialect(): boolean {
  return (process.env.LLM_DIALECT || "").toLowerCase() === "gigachat";
}

function baseUrl(): string {
  const fallback = isGigaChatDialect() ? GIGACHAT_BASE_URL : DEFAULT_BASE_URL;
  return (process.env.LLM_BASE_URL || fallback).replace(/\/+$/, "");
}

// ---------- авторизация ----------

let tokenCache: { token: string; expiresAt: number } | null = null;
let tokenPromise: Promise<string> | null = null;

export function resetOpenAiCompatTokenCache(): void {
  tokenCache = null;
  tokenPromise = null;
}

function usesGigaChatOauth(): boolean {
  return (process.env.LLM_AUTH || "").toLowerCase() === "gigachat_oauth";
}

async function fetchGigaChatToken(): Promise<string> {
  const url = process.env.LLM_OAUTH_URL || GIGACHAT_OAUTH_URL;
  const scope = process.env.LLM_OAUTH_SCOPE || "GIGACHAT_API_PERS";
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        RqUID: randomUUID(),
        Authorization: `Basic ${process.env.LLM_API_KEY}`,
      },
      body: new URLSearchParams({ scope }).toString(),
      signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS || 90000)),
    });
  } catch (e) {
    throw new YandexGptError(
      `Не удалось получить токен GigaChat (сертификаты Минцифры подключены?): ${e instanceof Error ? e.message : String(e)}`
    );
  }
  if (!res.ok) {
    throw new YandexGptError(`GigaChat OAuth вернул ошибку ${res.status}`, res.status);
  }
  const data = await res.json();
  const token: unknown = data?.access_token;
  if (typeof token !== "string" || !token) {
    throw new YandexGptError("GigaChat OAuth не вернул access_token", res.status);
  }
  const exp = Number(data?.expires_at);
  tokenCache = { token, expiresAt: Number.isFinite(exp) && exp > 0 ? exp : Date.now() + 25 * 60 * 1000 };
  return token;
}

async function authorizationHeader(forceRefresh = false): Promise<string> {
  if (!usesGigaChatOauth()) return `Bearer ${process.env.LLM_API_KEY}`;
  if (forceRefresh) tokenCache = null;
  if (tokenCache && tokenCache.expiresAt - Date.now() > 60_000) return `Bearer ${tokenCache.token}`;
  if (!tokenPromise) tokenPromise = fetchGigaChatToken().finally(() => { tokenPromise = null; });
  return `Bearer ${await tokenPromise}`;
}

function resolveModel(model: "pro" | "lite"): string {
  const pro = process.env.LLM_MODEL_PRO || "";
  if (model === "lite") return process.env.LLM_MODEL_LITE || pro;
  return pro;
}

// ---------- перевод сообщений в формат OpenAI ----------

type OpenAiMessage =
  | { role: "system" | "user" | "assistant"; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export function toOpenAiMessages(messages: YandexGptAnyMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  let pendingIds: string[] = [];
  let seq = 0;
  for (const m of messages) {
    if ("toolCallList" in m) {
      const calls = m.toolCallList.toolCalls;
      const ids = calls.map(() => `call_${++seq}`);
      pendingIds = [...ids];
      out.push({
        role: "assistant",
        content: null,
        tool_calls: calls.map((c, i) => ({
          id: ids[i],
          type: "function" as const,
          function: { name: c.functionCall.name, arguments: JSON.stringify(c.functionCall.arguments ?? {}) },
        })),
      });
    } else if ("toolResultList" in m) {
      for (const r of m.toolResultList.toolResults) {
        const id = pendingIds.shift() ?? `call_orphan_${++seq}`;
        out.push({ role: "tool", tool_call_id: id, content: r.functionResult.content });
      }
    } else {
      out.push({ role: m.role, content: (m as YandexGptMessage).text });
    }
  }
  return out;
}

/**
 * GigaChat отвергает (422 "Field 'properties.X.properties' is missing") объектные схемы без
 * `properties` (например, update_client.fields). Дополняем такие узлы пустым `properties`.
 */
export function sanitizeGigaChatSchema<T>(node: T): T {
  if (Array.isArray(node)) return node.map(sanitizeGigaChatSchema) as unknown as T;
  if (node && typeof node === "object") {
    const src = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) out[k] = sanitizeGigaChatSchema(v);
    if (out.type === "object" && out.properties === undefined) out.properties = {};
    return out as T;
  }
  return node;
}

/**
 * Сообщения в формате GigaChat: один function_call на сообщение ассистента,
 * результат — сообщение с ролью function, content — JSON-строка.
 * Пачка вызовов раскладывается на пары «вызов → результат».
 */
export function toGigaChatMessages(messages: YandexGptAnyMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  let pending: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const flushPending = () => {
    for (const c of pending) out.push({ role: "assistant", content: "", function_call: { name: c.name, arguments: c.arguments } });
    pending = [];
  };
  for (const m of messages) {
    if ("toolCallList" in m) {
      flushPending();
      pending = m.toolCallList.toolCalls.map(c => ({ name: c.functionCall.name, arguments: c.functionCall.arguments ?? {} }));
    } else if ("toolResultList" in m) {
      for (const r of m.toolResultList.toolResults) {
        const call = pending.shift();
        const name = call?.name ?? r.functionResult.name;
        out.push({ role: "assistant", content: "", function_call: { name, arguments: call?.arguments ?? {} } });
        let content = r.functionResult.content;
        try {
          JSON.parse(content);
        } catch {
          content = JSON.stringify({ result: content });
        }
        out.push({ role: "function", name, content });
      }
      flushPending();
    } else {
      flushPending();
      out.push({ role: m.role, content: (m as YandexGptMessage).text });
    }
  }
  flushPending();
  return out;
}

function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

// ---------- запрос ----------

export async function openAiCompatCompleteWithTools(
  messages: YandexGptAnyMessage[],
  options: YandexGptCompletionOptions = {}
): Promise<YandexGptCompletionResult> {
  const env = checkOpenAiCompatEnv();
  if (!env.configured) {
    throw new YandexGptError(`LLM-провайдер не настроен — отсутствуют ${env.missing.join(", ")}`);
  }
  const modelName = resolveModel(options.model ?? "pro");

  const gigachat = isGigaChatDialect();
  const body: Record<string, unknown> = {
    model: modelName,
    messages: gigachat ? toGigaChatMessages(messages) : toOpenAiMessages(messages),
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 2000,
    stream: false,
  };
  // В режиме GigaChat response_format не отправляем (формат структурированного вывода
  // у Сбера свой): JSON запрашивается в промпте, вызывающий код чистит markdown-обёртку.
  if (options.jsonObject && !gigachat) body.response_format = { type: "json_object" };
  if (options.tools && options.tools.length > 0) {
    if (gigachat) {
      body.functions = options.tools.map(t => sanitizeGigaChatSchema(t.function));
      body.function_call = options.forceToolName ? { name: options.forceToolName } : "auto";
    } else {
      body.tools = options.tools.map(t => ({ type: "function", function: t.function }));
      body.tool_choice = options.forceToolName ? { type: "function", function: { name: options.forceToolName } } : "auto";
    }
  }

  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 90000);
  const send = async (forceRefresh: boolean): Promise<Response> =>
    fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await authorizationHeader(forceRefresh),
        ...(gigachat && options.sessionId ? { "X-Session-ID": options.sessionId } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  let response: Response;
  try {
    response = await send(false);
    if (response.status === 401 && usesGigaChatOauth()) response = await send(true);
  } catch (e) {
    if (e instanceof YandexGptError) throw e;
    throw new YandexGptError(`Не удалось связаться с LLM-провайдером: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!response.ok) {
    let details: unknown;
    try {
      details = await response.json();
    } catch {
      details = await response.text().catch(() => undefined);
    }
    const serialized = typeof details === "string" ? details : JSON.stringify(details ?? "");
    // Тело ошибки провайдера (без пользовательских данных) — для разбора 4xx на стенде.
    console.error("LLM_ERROR", JSON.stringify({ status: response.status, model: modelName, body: serialized.slice(0, 500) }));
    const moderation = response.status === 400 && /content[_ -]?filter|moderation|модерац/i.test(serialized);
    throw new YandexGptError(
      `LLM-провайдер вернул ошибку ${response.status}`,
      response.status,
      moderation ? { moderation: true, raw: details } : details
    );
  }

  const data = await response.json();
  const choice = data?.choices?.[0];
  const rawUsage = data?.usage;
  const usage: YandexGptUsage | null = rawUsage
    ? {
        inputTextTokens: Number(rawUsage.prompt_tokens ?? 0),
        completionTokens: Number(rawUsage.completion_tokens ?? 0),
        totalTokens: Number(rawUsage.total_tokens ?? 0),
      }
    : null;
  if (usage) {
    console.log("LLM_USAGE", JSON.stringify({ model: modelName, ...usage, precached: rawUsage.precached_prompt_tokens ?? rawUsage.prompt_tokens_details?.cached_tokens ?? null }));
  }
  if (!choice) {
    throw new YandexGptError("LLM-провайдер вернул неожиданный формат ответа", response.status, data);
  }

  const fc = choice.message?.function_call as { name?: string; arguments?: unknown } | undefined;
  if (fc?.name) {
    let args: Record<string, unknown> = {};
    if (typeof fc.arguments === "string" && fc.arguments.trim()) {
      try {
        const parsed = JSON.parse(fc.arguments);
        if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
      } catch {
        console.warn("LLM_TOOL_ARGS_PARSE_FAILED", fc.name);
      }
    } else if (fc.arguments && typeof fc.arguments === "object") {
      args = fc.arguments as Record<string, unknown>;
    }
    return { text: null, toolCalls: [{ functionCall: { name: String(fc.name), arguments: args } }], model: modelName, usage };
  }

  const rawCalls: unknown = choice.message?.tool_calls;
  if (Array.isArray(rawCalls) && rawCalls.length > 0) {
    const toolCalls: YandexGptToolCall[] = rawCalls.map((c: { function?: { name?: string; arguments?: unknown } }) => {
      let args: Record<string, unknown> = {};
      const a = c.function?.arguments;
      if (typeof a === "string" && a.trim()) {
        try {
          const parsed = JSON.parse(a);
          if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
        } catch {
          console.warn("LLM_TOOL_ARGS_PARSE_FAILED", c.function?.name);
        }
      } else if (a && typeof a === "object") {
        args = a as Record<string, unknown>;
      }
      return { functionCall: { name: String(c.function?.name ?? ""), arguments: args } };
    });
    return { text: null, toolCalls, model: modelName, usage };
  }

  if (options.throwOnContentFilter && choice.finish_reason === "content_filter") {
    throw new YandexGptError("LLM: ответ заблокирован фильтром контента", 400, { moderation: true });
  }

  const content: unknown = choice.message?.content;
  if (typeof content !== "string") {
    throw new YandexGptError("LLM-провайдер вернул неожиданный формат ответа", response.status, data);
  }
  const text = stripThink(content);
  if (options.throwOnContentFilter && isModerationRefusalText(text)) {
    throw new YandexGptError("LLM: отказ модерации в тексте ответа", 400, { moderation: true });
  }
  return { text, toolCalls: null, model: modelName, usage };
}

// ---------- «асинхронный» режим (эмуляция в памяти процесса) ----------

interface LocalOp {
  done: boolean;
  text: string | null;
  error: string | null;
  moderated?: boolean;
  createdAt: number;
}

const OPS_TTL_MS = 2 * 60 * 60 * 1000;

function opsStore(): Map<string, LocalOp> {
  const g = globalThis as unknown as { __llmLocalOps?: Map<string, LocalOp> };
  if (!g.__llmLocalOps) g.__llmLocalOps = new Map();
  return g.__llmLocalOps;
}

export async function openAiCompatStartAsyncCompletion(
  messages: YandexGptMessage[],
  options: YandexGptCompletionOptions = {}
): Promise<string> {
  const env = checkOpenAiCompatEnv();
  if (!env.configured) {
    throw new YandexGptError(`LLM-провайдер не настроен — отсутствуют ${env.missing.join(", ")}`);
  }
  const store = opsStore();
  const now = Date.now();
  for (const [k, v] of store) if (now - v.createdAt > OPS_TTL_MS) store.delete(k);

  const id = `local-${randomUUID()}`;
  store.set(id, { done: false, text: null, error: null, createdAt: now });
  void openAiCompatCompleteWithTools(messages, { ...options, tools: undefined, throwOnContentFilter: true })
    .then(r => {
      store.set(id, { done: true, text: r.text, error: null, createdAt: now });
    })
    .catch(e => {
      const moderated = e instanceof YandexGptError && (e.details as { moderation?: boolean } | undefined)?.moderation === true;
      store.set(id, {
        done: true,
        text: null,
        error: e instanceof Error ? e.message : "Операция завершилась ошибкой",
        moderated: moderated || undefined,
        createdAt: now,
      });
    });
  return id;
}

export async function openAiCompatGetAsyncOperation(operationId: string): Promise<YandexGptAsyncOperationStatus> {
  const op = opsStore().get(operationId);
  if (!op) {
    return { done: true, text: null, error: "Операция не найдена (процесс мог быть перезапущен), запустите генерацию заново" };
  }
  if (!op.done) return { done: false, text: null, error: null };
  return { done: true, text: op.text, error: op.error, ...(op.moderated ? { moderated: true } : {}) };
}


// ---------- эмбеддинги ----------

/**
 * Эмбеддинг через OpenAI-совместимый /embeddings (GigaChat: модель «Embeddings», 1024 числа,
 * до 512 токенов на текст). Модель задаётся LLM_EMBEDDINGS_MODEL; для GigaChat по умолчанию
 * «Embeddings». Длинный текст обрезается до LLM_EMBEDDINGS_MAX_CHARS (по умолчанию 1500 символов):
 * чанки транскриптов и базы знаний — около 1050, так что обрезка срабатывает только на исключениях.
 */
export async function openAiCompatEmbed(text: string): Promise<number[]> {
  const model = process.env.LLM_EMBEDDINGS_MODEL || (isGigaChatDialect() ? "Embeddings" : "");
  if (!model) throw new YandexGptError("Эмбеддинги не настроены — задайте LLM_EMBEDDINGS_MODEL");
  const maxChars = Number(process.env.LLM_EMBEDDINGS_MAX_CHARS || 1500);
  const input = text.length > maxChars ? text.slice(0, maxChars) : text;
  const send = async (forceRefresh: boolean): Promise<Response> =>
    fetch(`${baseUrl()}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: await authorizationHeader(forceRefresh) },
      body: JSON.stringify({ model, input: [input] }),
      signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS || 90000)),
    });
  let res: Response;
  try {
    res = await send(false);
    if (res.status === 401 && usesGigaChatOauth()) res = await send(true);
  } catch (e) {
    if (e instanceof YandexGptError) throw e;
    throw new YandexGptError(`Не удалось получить эмбеддинг: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("EMBED_ERROR", JSON.stringify({ status: res.status, model, body: body.slice(0, 300) }));
    throw new YandexGptError(`Эмбеддинги вернули ошибку ${res.status}`, res.status);
  }
  const data = await res.json();
  const emb: unknown = data?.data?.[0]?.embedding;
  if (!Array.isArray(emb) || emb.length === 0) throw new YandexGptError("Эмбеддинги вернули пустой ответ");
  return emb as number[];
}
