import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/yandexgpt", async () => {
  const actual = await vi.importActual<typeof import("@/lib/yandexgpt")>("@/lib/yandexgpt");
  return { ...actual, yandexGptCompleteJson: vi.fn() };
});

import { yandexGptCompleteJson, YandexGptError } from "@/lib/yandexgpt";
import { anonymizeTranscript, applyReplacements, collapseDuplicates, findDateMentions, findSuspiciousProperNouns, scrubDates } from "../anonymize";

const mocked = vi.mocked(yandexGptCompleteJson);
const FAST = { retryDelayMs: 0 };

describe("applyReplacements", () => {
  it("замена в начале предложения начинается с заглавной", () => {
    const out = applyReplacements("Ну да. Пётр Ильич позвонил вчера.", [{ original: "Пётр Ильич", replacement: "отец" }], "Игорь");
    expect(out).toBe("Ну да. Отец позвонил вчера.");
  });
  it("в середине предложения регистр замены не меняется", () => {
    const out = applyReplacements("Вчера Пётр Ильич позвонил.", [{ original: "Пётр Ильич", replacement: "отец" }], "Игорь");
    expect(out).toBe("Вчера отец позвонил.");
  });
  it("имя клиента не заменяется, даже если модель его вернула", () => {
    const out = applyReplacements("Игорь, как вы?", [{ original: "Игорь", replacement: "клиент" }], "Игорь");
    expect(out).toBe("Игорь, как вы?");
  });
  it("схлопывает задвоение, возникшее из-за замены", () => {
    const out = applyReplacements("Устаю в Сбербанке на работе.", [{ original: "в Сбербанке", replacement: "на работе" }], "Игорь");
    expect(out).toBe("Устаю на работе.");
  });
  it("заменяет все вхождения", () => {
    const out = applyReplacements("Оксана сказала, что Оксана устала.", [{ original: "Оксана", replacement: "сестра" }], "Игорь");
    expect(out).toBe("Сестра сказала, что сестра устала.");
  });
});

describe("collapseDuplicates", () => {
  it("трогает только фразы-замены, живые повторы оставляет", () => {
    expect(collapseDuplicates("в метро в метро было душно, очень очень", ["в метро"])).toBe("в метро было душно, очень очень");
  });
});

describe("findSuspiciousProperNouns", () => {
  const text = "Психолог: Как прошла неделя?\nКлиент: Сестра Оксана приехала из Бердска. Игорю было тяжело.";
  const words = findSuspiciousProperNouns(text, "Игорь").map(x => x.word);
  it("находит имена и города не в начале предложения", () => {
    expect(words).toContain("Оксана");
    expect(words).toContain("Бердска");
  });
  it("не берёт метки говорящих, начало предложения и имя клиента", () => {
    expect(words).not.toContain("Психолог");
    expect(words).not.toContain("Клиент");
    expect(words).not.toContain("Сестра");
    expect(words).not.toContain("Игорю");
  });
});

describe("второй проход", () => {
  beforeEach(() => { mocked.mockClear(); mocked.mockImplementation(async () => ({ replacements: [] })); });
  it("дочищает пропущенное первым проходом", async () => {
    mocked
      .mockResolvedValueOnce({ replacements: [] })
      .mockResolvedValueOnce({ replacements: [{ original: "Оксана", replacement: "" }, { original: "из Бердска", replacement: "из другого города" }] });
    const out = await anonymizeTranscript("Вчера сестра Оксана приехала из Бердска, и мы поругались.", "Игорь", FAST);
    expect(out).toBe("Вчера сестра приехала из другого города, и мы поругались.");
    expect(mocked).toHaveBeenCalledTimes(2);
    const sent = mocked.mock.calls[1][0].find(m => m.role === "user")!.text;
    expect(sent).toContain("Оксана");
  });
  it("без подозрительных слов второго запроса нет", async () => {
    mocked.mockResolvedValueOnce({ replacements: [] });
    await anonymizeTranscript("Вчера мы с сестрой поругались.", "Игорь", FAST);
    expect(mocked).toHaveBeenCalledTimes(1);
  });
  it("сбой второго прохода — fail-closed", async () => {
    let calls = 0;
    mocked.mockImplementation(async () => {
      calls++;
      if (calls === 1) return { replacements: [] };
      throw new YandexGptError("YandexGPT вернул ошибку 503", 503);
    });
    let reason = "";
    try {
      await anonymizeTranscript("Вчера сестра Оксана приехала.", "Игорь", FAST);
    } catch (e) {
      reason = (e as { reason?: string }).reason ?? "";
    }
    expect(reason).toBe("llm_error");
  });
});

describe("findDateMentions", () => {
  it("находит точные даты, но не относительные", () => {
    const w = findDateMentions("14 октября поругались, а 03.10.2026 было тихо; на прошлой неделе и в мае — нет, 2 раза в неделю").map(x => x.word);
    expect(w).toEqual(["14 октября", "03.10.2026"]);
  });
  it("оставшаяся дата уходит во второй проход", async () => {
    mocked.mockReset();
    mocked
      .mockResolvedValueOnce({ replacements: [] })
      .mockResolvedValueOnce({ replacements: [{ original: "14 октября", replacement: "на прошлой неделе" }] });
    const out = await anonymizeTranscript("Тяжело. 14 октября поругался с отцом.", "Игорь", FAST);
    expect(out).toBe("Тяжело. На прошлой неделе поругался с отцом.");
  });
});

describe("scrubDates", () => {
  it("заменяет даты на «недавно», в начале предложения с заглавной", () => {
    expect(scrubDates("Тяжело. 14 октября, на выходных, поругался. Было 03.10.2026 тихо.")).toBe("Тяжело. Недавно, на выходных, поругался. Было недавно тихо.");
  });
  it("не трогает текст без дат", () => {
    expect(scrubDates("Раз в неделю, 2 раза в месяц")).toBe("Раз в неделю, 2 раза в месяц");
  });
  it("если модель не заменила дату — второй проход всё равно её убирает", async () => {
    mocked.mockReset();
    mocked.mockResolvedValueOnce({ replacements: [] }).mockResolvedValueOnce({ replacements: [] });
    const out = await anonymizeTranscript("Тяжело. 14 октября поругался с отцом.", "Игорь", FAST);
    expect(out).toBe("Тяжело. Недавно поругался с отцом.");
  });
});
