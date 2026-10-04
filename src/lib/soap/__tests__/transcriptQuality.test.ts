import { describe, it, expect } from "vitest";
import { assessTranscriptQuality, countMeaningfulWords, MIN_TOTAL_WORDS, MIN_CLIENT_WORDS } from "../transcriptQuality";
import { PROFANITY_MARKER } from "@/lib/profanity";

function words(n: number, prefix = "слово"): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}ъ`).join(" ");
}
function dialogue(psy: number, client: number): string {
  return `Психолог: ${words(psy, "псих")}\n\nКлиент: ${words(client, "клиент")}`;
}

describe("assessTranscriptQuality", () => {
  it("пустой и null -> empty", () => {
    expect(assessTranscriptQuality("").ok).toBe(false);
    expect(assessTranscriptQuality(null)).toMatchObject({ ok: false, reason: "empty" });
    expect(assessTranscriptQuality("Психолог: .\n\nКлиент: .")).toMatchObject({ ok: false, reason: "empty" });
  });

  it("слишком короткий -> too_short (реальный случай 03.10: ~50 слов за 146 с)", () => {
    const real =
      "Психолог: .\n\nКлиент: бязательно Здравствуйте.\n\nКлиент: Что-то не успеваю ничего делать особо. Так, сейчас ещё. Так, как бы мне открыть мысли? Так, или оно? А никак мне\n\nПсихолог: Здравствуйте, Анна. Как вы себя чувствовали на этой неделе?\n\nПсихолог: Что в первую очередь вас беспокоило?\n\nПсихолог: Как это отражалось на нашем сне и настроении?";
    expect(assessTranscriptQuality(real, 146)).toMatchObject({ ok: false, reason: "too_short" });
  });

  it("клиент почти молчит -> client_silent", () => {
    expect(assessTranscriptQuality(dialogue(200, MIN_CLIENT_WORDS - 1))).toMatchObject({ ok: false, reason: "client_silent" });
  });

  it("низкая плотность речи на длинной записи -> low_speech_density", () => {
    const text = dialogue(MIN_TOTAL_WORDS, MIN_TOTAL_WORDS);
    // 240 слов за 30 минут = 8 слов/мин
    expect(assessTranscriptQuality(text, 1800)).toMatchObject({ ok: false, reason: "low_speech_density" });
  });

  it("зацикленный ASR (одно и то же слово) -> repetitive", () => {
    const text = `Психолог: ${"да ".repeat(100)}\n\nКлиент: ${"нет ".repeat(100)}`;
    expect(assessTranscriptQuality(text)).toMatchObject({ ok: false, reason: "repetitive" });
  });

  it("почти весь текст — маркеры цензуры -> mostly_censored", () => {
    const text = `Психолог: ${words(100, "п")}\n\nКлиент: ${(PROFANITY_MARKER + " ").repeat(150)} ${words(60, "к")}`;
    expect(assessTranscriptQuality(text)).toMatchObject({ ok: false, reason: "mostly_censored" });
  });

  it("нормальный диалог проходит", () => {
    const verdict = assessTranscriptQuality(dialogue(150, 150), 600);
    expect(verdict.ok).toBe(true);
  });

  it("транскрипт без разметки спикеров проверяется только по общему объёму", () => {
    expect(assessTranscriptQuality(words(MIN_TOTAL_WORDS + 10)).ok).toBe(true);
    expect(assessTranscriptQuality(words(30))).toMatchObject({ ok: false, reason: "too_short" });
  });
});

describe("countMeaningfulWords", () => {
  it("не считает слова-паразиты, метки спикеров и маркер цензуры", () => {
    expect(countMeaningfulWords(`ну э-э вот ${PROFANITY_MARKER} мне тревожно`)).toBe(2);
  });
});
