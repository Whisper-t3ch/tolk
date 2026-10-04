import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/yandexgpt", async () => {
  const actual = await vi.importActual<typeof import("@/lib/yandexgpt")>("@/lib/yandexgpt");
  return { ...actual, yandexGptCompleteJson: vi.fn() };
});

import { yandexGptCompleteJson, YandexGptError } from "@/lib/yandexgpt";
import { anonymizeTranscript, AnonymizationError } from "../anonymize";
import { PROFANITY_MARKER } from "../profanity";

const mocked = vi.mocked(yandexGptCompleteJson);
const FAST = { retryDelayMs: 0 };
const SECRET = "ЛИЧНЫЙ_ТЕКСТ_СЕССИИ_Игорь";

// Возвращаем результат-обёртку, а не сам Error: промис, резолвящийся Error-объектом, vitest в
// некоторых случаях показывает как падение теста этой ошибкой.
async function failure(promise: Promise<string>): Promise<{ reason: string; message: string }> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(AnonymizationError);
    const err = e as AnonymizationError;
    return { reason: err.reason, message: err.message };
  }
  throw new Error("ожидалась AnonymizationError");
}

describe("anonymizeTranscript (fail-closed)", () => {
  beforeEach(() => { mocked.mockClear(); mocked.mockImplementation(async () => ({ replacements: [] })); });

  it("применяет замены и маскирует мат ДО отправки в YandexGPT", async () => {
    mocked.mockResolvedValue({ replacements: [{ original: "мужем Игорем", replacement: "мужем" }] });
    const out = await anonymizeTranscript("Поссорилась с мужем Игорем, он блядь орал", "Анна", FAST);
    expect(out).toBe(`Поссорилась с мужем, он ${PROFANITY_MARKER} орал`);
    const sent = mocked.mock.calls[0][0].find(m => m.role === "user")!.text;
    expect(sent).toContain(PROFANITY_MARKER);
    expect(sent).not.toMatch(/блядь/i);
  });

  it("не заменяет имя клиента, даже если модель его вернула", async () => {
    mocked.mockResolvedValue({ replacements: [{ original: "Анна", replacement: "клиентка" }] });
    expect(await anonymizeTranscript("Анна рассказала о сне и тревоге на этой неделе", "Анна", FAST)).toBe(
      "Анна рассказала о сне и тревоге на этой неделе"
    );
  });

  it("пустая карта замен — валидный результат (в тексте нет ПДн)", async () => {
    mocked.mockResolvedValue({ replacements: [] });
    expect(await anonymizeTranscript("Было тяжело спать", "Анна", FAST)).toBe("Было тяжело спать");
  });

  it("модерация YandexGPT -> AnonymizationError(moderation_rejected), без повторов", async () => {
    mocked.mockImplementation(async () => { throw new YandexGptError("YandexGPT вернул ошибку 400", 400, { error: { message: "Я не могу обсуждать эту тему" } }); });
    const err = await failure(anonymizeTranscript(SECRET, "Анна", FAST));
    expect(err.reason).toBe("moderation_rejected");
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(err.message).not.toContain(SECRET);
  });

  it("временный сбой повторяется, затем успех", async () => {
    mocked
      .mockRejectedValueOnce(new YandexGptError("YandexGPT вернул ошибку 429", 429))
      .mockResolvedValueOnce({ replacements: [] });
    expect(await anonymizeTranscript("Привет, как дела у вас сегодня", "Анна", FAST)).toBe("Привет, как дела у вас сегодня");
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it("стойкий сбой после повторов -> llm_error, сырой текст не возвращается", async () => {
    mocked.mockImplementation(async () => { throw new YandexGptError("YandexGPT вернул ошибку 503", 503); });
    const err = await failure(anonymizeTranscript(SECRET, "Анна", FAST));
    expect(err.reason).toBe("llm_error");
    expect(mocked).toHaveBeenCalledTimes(3);
    expect(err.message).not.toContain(SECRET);
  });

  it("ответ не JSON -> invalid_response", async () => {
    mocked.mockImplementation(async () => { throw new YandexGptError("Не удалось разобрать JSON-ответ YandexGPT", undefined, SECRET); });
    const err = await failure(anonymizeTranscript(SECRET, "Анна", FAST));
    expect(err.reason).toBe("invalid_response");
    expect(err.message).not.toContain(SECRET);
  });

  it.each([
    ["null", null],
    ["без replacements", {}],
    ["replacements не массив", { replacements: "нет" }],
    ["элемент без original", { replacements: [{ replacement: "x" }] }],
    ["replacement не строка", { replacements: [{ original: "a", replacement: 5 }] }],
  ])("некорректная схема (%s) -> invalid_response", async (_name, payload) => {
    mocked.mockResolvedValue(payload as never);
    const err = await failure(anonymizeTranscript("Какой-то текст сессии для проверки схемы", "Анна", FAST));
    expect(err.reason).toBe("invalid_response");
  });

  it("замены стёрли весь текст -> empty_result", async () => {
    const text = "Игорь Игорь";
    mocked.mockResolvedValue({ replacements: [{ original: "Игорь Игорь", replacement: "" }] });
    expect((await failure(anonymizeTranscript(text, "Анна", FAST))).reason).toBe("empty_result");
  });

  it("замены стёрли большую часть длинного текста -> suspicious_result", async () => {
    const long = "Слово ".repeat(60) + "Игорь";
    mocked.mockResolvedValue({ replacements: [{ original: "Слово ", replacement: "" }] });
    expect((await failure(anonymizeTranscript(long, "Анна", FAST))).reason).toBe("suspicious_result");
  });

  it("пустой вход возвращается как есть без вызова LLM", async () => {
    expect(await anonymizeTranscript("   ", "Анна", FAST)).toBe("   ");
    expect(mocked).not.toHaveBeenCalled();
  });
});
