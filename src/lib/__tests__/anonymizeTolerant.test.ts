import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/yandexgpt", async () => {
  const actual = await vi.importActual<typeof import("@/lib/yandexgpt")>("@/lib/yandexgpt");
  return { ...actual, yandexGptCompleteJson: vi.fn() };
});

import { yandexGptCompleteJson, YandexGptError } from "@/lib/yandexgpt";
import { anonymizeTranscriptsTolerant, MODERATION_PLACEHOLDER } from "../anonymize";

const mocked = vi.mocked(yandexGptCompleteJson);
const FAST = { retryDelayMs: 0 };
const BAD = "ЗАПРЕЩЁННОЕ_СЛОВО";

function moderationError() {
  return new YandexGptError("LLM: ответ заблокирован фильтром контента", 400, { moderation: true });
}

describe("anonymizeTranscriptsTolerant", () => {
  beforeEach(() => {
    mocked.mockReset();
    mocked.mockImplementation(async messages => {
      const user = messages.find(m => m.role === "user")!.text;
      if (user.includes(BAD)) throw moderationError();
      return { replacements: [] };
    });
  });

  it("без отказов работает как обычно", async () => {
    const out = await anonymizeTranscriptsTolerant(["Мне было тяжело спать.", "Работа выматывает."], "Анна", FAST);
    expect(out.texts).toEqual(["Мне было тяжело спать.", "Работа выматывает."]);
    expect(out.moderatedFragments).toBe(0);
  });

  it("отклонённое предложение заменяется заглушкой, остальной сегмент проходит, сырой текст не сохраняется", async () => {
    const out = await anonymizeTranscriptsTolerant([`Сегодня был тяжёлый день. Он сказал ${BAD}. Потом я ушла домой.`, "Другой сегмент."], "Анна", FAST);
    expect(out.moderatedFragments).toBe(1);
    expect(out.texts[0]).toBe(`Сегодня был тяжёлый день. ${MODERATION_PLACEHOLDER} Потом я ушла домой.`);
    expect(out.texts[0]).not.toContain(BAD);
    expect(out.texts[1]).toBe("Другой сегмент.");
  });

  it("односложный сегмент с отказом целиком заменяется заглушкой", async () => {
    const out = await anonymizeTranscriptsTolerant([`Это ${BAD}`], "Анна", FAST);
    expect(out.texts).toEqual([MODERATION_PLACEHOLDER]);
    expect(out.moderatedFragments).toBe(1);
  });

  it("прочие ошибки остаются fail-closed", async () => {
    mocked.mockImplementation(async () => {
      throw new YandexGptError("Не удалось разобрать JSON", 200);
    });
    await expect(anonymizeTranscriptsTolerant(["Обычный текст сессии."], "Анна", FAST)).rejects.toThrow();
  });
});
