import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetOpenAiCompatTokenCache,
  toGigaChatMessages,
  sanitizeGigaChatSchema,
  openAiCompatCompleteWithTools,
  openAiCompatGetAsyncOperation,
  openAiCompatStartAsyncCompletion,
  toOpenAiMessages,
} from "../openaiCompat";
import { yandexGptCompleteWithTools, checkYandexGptEnv } from "../../yandexgpt";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("toOpenAiMessages", () => {
  it("переводит текст, вызовы функций и результаты с согласованными id", () => {
    const out = toOpenAiMessages([
      { role: "system", text: "sys" },
      { role: "user", text: "привет" },
      {
        role: "assistant",
        toolCallList: {
          toolCalls: [
            { functionCall: { name: "get_clients", arguments: {} } },
            { functionCall: { name: "get_client_info", arguments: { id: "1" } } },
          ],
        },
      },
      {
        role: "user",
        toolResultList: {
          toolResults: [
            { functionResult: { name: "get_clients", content: "[]" } },
            { functionResult: { name: "get_client_info", content: "{}" } },
          ],
        },
      },
    ]);
    expect(out[0]).toEqual({ role: "system", content: "sys" });
    expect(out[1]).toEqual({ role: "user", content: "привет" });
    const assistant = out[2] as { tool_calls: Array<{ id: string; function: { name: string; arguments: string } }> };
    expect(assistant.tool_calls.map(c => c.id)).toEqual(["call_1", "call_2"]);
    expect(assistant.tool_calls[1].function.arguments).toBe('{"id":"1"}');
    expect(out[3]).toEqual({ role: "tool", tool_call_id: "call_1", content: "[]" });
    expect(out[4]).toEqual({ role: "tool", tool_call_id: "call_2", content: "{}" });
  });
});

describe("openAiCompatCompleteWithTools", () => {
  beforeEach(() => {
    vi.stubEnv("LLM_PROVIDER", "openai_compat");
    vi.stubEnv("LLM_API_KEY", "test-key");
    vi.stubEnv("LLM_MODEL_PRO", "pro-model");
    vi.stubEnv("LLM_MODEL_LITE", "lite-model");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("отправляет OpenAI-запрос и разбирает tool_calls и usage", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{ id: "x", type: "function", function: { name: "get_clients", arguments: '{"limit":3}' } }],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await openAiCompatCompleteWithTools([{ role: "user", text: "q" }], {
      model: "lite",
      tools: [{ function: { name: "get_clients", description: "d", parameters: { type: "object", properties: {} } } }],
    });
    expect(r.toolCalls).toEqual([{ functionCall: { name: "get_clients", arguments: { limit: 3 } } }]);
    expect(r.text).toBeNull();
    expect(r.model).toBe("lite-model");
    expect(r.usage).toEqual({ inputTextTokens: 10, completionTokens: 5, totalTokens: 15 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://foundation-models.api.cloud.ru/v1/chat/completions");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.model).toBe("lite-model");
    expect(body.tools[0]).toMatchObject({ type: "function", function: { name: "get_clients" } });
    expect((init as RequestInit & { headers: Record<string, string> }).headers.Authorization).toBe("Bearer test-key");
  });

  it("возвращает текст и вырезает <think>", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ choices: [{ finish_reason: "stop", message: { content: "<think>рассуждаю</think>Ответ" } }] })
    );
    const r = await openAiCompatCompleteWithTools([{ role: "user", text: "q" }]);
    expect(r.text).toBe("Ответ");
    expect(r.toolCalls).toBeNull();
  });

  it("битые arguments превращаются в пустой объект, а не в исключение", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        choices: [{ message: { tool_calls: [{ function: { name: "f", arguments: "{oops" } }] } }],
      })
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await openAiCompatCompleteWithTools([{ role: "user", text: "q" }]);
    expect(r.toolCalls).toEqual([{ functionCall: { name: "f", arguments: {} } }]);
  });

  it("content_filter при throwOnContentFilter даёт moderation-ошибку", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ choices: [{ finish_reason: "content_filter", message: { content: "" } }] })
    );
    await expect(
      openAiCompatCompleteWithTools([{ role: "user", text: "q" }], { throwOnContentFilter: true })
    ).rejects.toMatchObject({ status: 400, details: { moderation: true } });
  });

  it("HTTP-ошибка превращается в YandexGptError со статусом", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "rate limit" }, 429));
    await expect(openAiCompatCompleteWithTools([{ role: "user", text: "q" }])).rejects.toMatchObject({ status: 429 });
  });

  it("асинхронный режим: старт → опрос → результат", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ choices: [{ finish_reason: "stop", message: { content: "{\"ok\":true}" } }] })
    );
    const id = await openAiCompatStartAsyncCompletion([{ role: "user", text: "q" }], { jsonObject: true });
    let st = await openAiCompatGetAsyncOperation(id);
    for (let i = 0; i < 20 && !st.done; i++) {
      await new Promise(r => setTimeout(r, 5));
      st = await openAiCompatGetAsyncOperation(id);
    }
    expect(st).toEqual({ done: true, text: '{"ok":true}', error: null });
  });

  it("yandexgpt.ts при LLM_PROVIDER=openai_compat делегирует провайдеру и проверяет его env", async () => {
    expect(checkYandexGptEnv()).toEqual({ configured: true, missing: [] });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ choices: [{ finish_reason: "stop", message: { content: "ok" } }] })
    );
    const r = await yandexGptCompleteWithTools([{ role: "user", text: "q" }]);
    expect(r.text).toBe("ok");
    expect(r.model).toBe("pro-model");
  });

  it("без LLM_API_KEY провайдер сообщает о нехватке настроек", async () => {
    vi.stubEnv("LLM_API_KEY", "");
    expect(checkYandexGptEnv()).toEqual({ configured: false, missing: ["LLM_API_KEY"] });
  });
});

describe("режим GigaChat (Сбер)", () => {
  beforeEach(() => {
    resetOpenAiCompatTokenCache();
    vi.stubEnv("LLM_PROVIDER", "openai_compat");
    vi.stubEnv("LLM_DIALECT", "gigachat");
    vi.stubEnv("LLM_AUTH", "gigachat_oauth");
    vi.stubEnv("LLM_API_KEY", "auth-key");
    vi.stubEnv("LLM_MODEL_PRO", "GigaChat-2-Max");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("раскладывает пачку вызовов на пары function_call → role:function с JSON-контентом", () => {
    const out = toGigaChatMessages([
      { role: "user", text: "q" },
      {
        role: "assistant",
        toolCallList: {
          toolCalls: [
            { functionCall: { name: "a", arguments: { x: 1 } } },
            { functionCall: { name: "b", arguments: {} } },
          ],
        },
      },
      {
        role: "user",
        toolResultList: {
          toolResults: [
            { functionResult: { name: "a", content: '{"ok":true}' } },
            { functionResult: { name: "b", content: "просто текст" } },
          ],
        },
      },
    ]);
    expect(out).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "", function_call: { name: "a", arguments: { x: 1 } } },
      { role: "function", name: "a", content: '{"ok":true}' },
      { role: "assistant", content: "", function_call: { name: "b", arguments: {} } },
      { role: "function", name: "b", content: '{"result":"просто текст"}' },
    ]);
  });

  it("получает токен один раз, отправляет functions и разбирает function_call", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/oauth")) {
        return jsonResponse({ access_token: "tok-1", expires_at: Date.now() + 30 * 60 * 1000 });
      }
      return jsonResponse({
        choices: [{ finish_reason: "function_call", message: { content: "", function_call: { name: "get_clients", arguments: { limit: 2 } } } }],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      });
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const tools = [{ function: { name: "get_clients", description: "d", parameters: { type: "object" as const, properties: {} } } }];
    const r1 = await openAiCompatCompleteWithTools([{ role: "user", text: "q" }], { tools, jsonObject: true });
    const r2 = await openAiCompatCompleteWithTools([{ role: "user", text: "q" }], { tools });
    expect(r1.toolCalls).toEqual([{ functionCall: { name: "get_clients", arguments: { limit: 2 } } }]);
    expect(r2.toolCalls).toHaveLength(1);

    const oauthCalls = fetchMock.mock.calls.filter(c => String(c[0]).includes("/oauth"));
    expect(oauthCalls).toHaveLength(1);
    const oauthInit = oauthCalls[0][1] as RequestInit & { headers: Record<string, string> };
    expect(oauthInit.headers.Authorization).toBe("Basic auth-key");
    expect(oauthInit.headers.RqUID).toMatch(/^[0-9a-f-]{36}$/);
    expect(String(oauthInit.body)).toBe("scope=GIGACHAT_API_PERS");

    const chat = fetchMock.mock.calls.find(c => String(c[0]).endsWith("/chat/completions"))!;
    expect(String(chat[0])).toBe("https://gigachat.devices.sberbank.ru/api/v1/chat/completions");
    const body = JSON.parse(String((chat[1] as RequestInit).body));
    expect(body.functions[0].name).toBe("get_clients");
    expect(body.function_call).toBe("auto");
    expect(body.tools).toBeUndefined();
    expect(body.response_format).toBeUndefined();
    expect((chat[1] as RequestInit & { headers: Record<string, string> }).headers.Authorization).toBe("Bearer tok-1");
  });

  it("при 401 обновляет токен и повторяет запрос", async () => {
    let oauthN = 0;
    let chatN = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/oauth")) {
        oauthN += 1;
        return jsonResponse({ access_token: `tok-${oauthN}`, expires_at: Date.now() + 30 * 60 * 1000 });
      }
      chatN += 1;
      if (chatN === 1) return jsonResponse({ message: "expired" }, 401);
      return jsonResponse({ choices: [{ finish_reason: "stop", message: { content: "ok" } }] });
    });
    const r = await openAiCompatCompleteWithTools([{ role: "user", text: "q" }]);
    expect(r.text).toBe("ok");
    expect(oauthN).toBe(2);
    expect(chatN).toBe(2);
  });
});

describe("sanitizeGigaChatSchema", () => {
  it("добавляет пустой properties объектам без него, вложенным тоже", () => {
    const out = sanitizeGigaChatSchema({
      name: "update_client",
      parameters: { type: "object", properties: { fields: { type: "object", description: "x" } } },
    });
    expect((out.parameters.properties.fields as Record<string, unknown>).properties).toEqual({});
  });
  it("не трогает уже заполненные схемы", () => {
    const src = { type: "object", properties: { a: { type: "string" } } };
    expect(sanitizeGigaChatSchema(src)).toEqual(src);
  });
});
