import { describe, expect, it } from "vitest";
import { normalizePeriodSummary } from "../periodSummary";

describe("normalizePeriodSummary", () => {
  it("принимает правильную форму как есть", () => {
    const r = normalizePeriodSummary({ key_themes: "a", dynamics: "b", progress: "c", patterns: "d", open_questions: "e" });
    expect(r).toEqual({ key_themes: "a", dynamics: "b", progress: "c", patterns: "d", open_questions: "e" });
  });
  it("разворачивает обёртку, русские ключи и списки", () => {
    const r = normalizePeriodSummary({
      summary: { "Ключевые темы": ["гнев", "мама"], "Динамика": "лучше", "Прогресс": "паузы", "Повторяющиеся паттерны": "срывы", "Незакрытые вопросы": "карьера" },
    });
    expect(r.key_themes).toBe("— гнев\n— мама");
    expect(r.dynamics).toBe("лучше");
    expect(r.open_questions).toBe("карьера");
  });
  it("пустые строки для отсутствующих полей, без undefined", () => {
    expect(normalizePeriodSummary({ key_themes: "a" }).dynamics).toBe("");
  });
});
