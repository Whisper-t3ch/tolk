import { describe, expect, it } from "vitest";
import { keywordSearchTranscripts } from "../keywordHistorySearch";

const t = [
  { session_id: "b", scheduled_at: "2026-09-08T17:00:00Z", raw_text: "Психолог: Как неделя?\n\nКлиент: Я сорвалась на дочь, кричала.\n\nПсихолог: Что было до этого?" },
  { session_id: "a", scheduled_at: "2026-09-01T17:00:00Z", raw_text: "Клиент: Я всё время злюсь на мужа.\n\nПсихолог: Расскажите про работу." },
  { session_id: "c", scheduled_at: "2026-09-15T17:00:00Z", raw_text: "Клиент: Про работу всё нормально." },
];

describe("keywordSearchTranscripts", () => {
  it("находит формы слова и связанные слова темы, по порядку сессий", () => {
    const r = keywordSearchTranscripts("злость", t);
    expect(r.map(x => x.session_id)).toEqual(["a", "b"]);
    expect(r[0].session_number).toBe(1);
    expect(r[1].excerpts[0]).toContain("сорвалась");
  });
  it("пусто, если совпадений нет", () => {
    expect(keywordSearchTranscripts("медитация", t)).toEqual([]);
  });
});
