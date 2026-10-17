import { describe, it, expect, vi } from "vitest";
import { guardResponseText, stripUuids } from "../responseGuard";

const ID = "c19312f4-9f3f-400d-83b5-976563f59616";

describe("stripUuids", () => {
  it("убирает id в скобках и после «id:»", () => {
    expect(stripUuids(`Клиент Анна (id: ${ID}) ходит давно.`)).toBe("Клиент Анна ходит давно.");
    expect(stripUuids(`Сессия ID: ${ID} прошла хорошо.`)).toBe("Сессия прошла хорошо.");
  });
  it("убирает голый uuid и лишние пробелы перед знаками", () => {
    expect(stripUuids(`Анна ${ID}, Игорь`)).toBe("Анна, Игорь");
  });
});

describe("guardResponseText", () => {
  it("безопасный текст не меняет", () => {
    expect(guardResponseText("Анна рассказывала про сон.")).toBe("Анна рассказывала про сон.");
  });
  it("uuid в длинном ответе вырезает, а не блокирует весь ответ", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = guardResponseText(`У клиентки Анна (id: ${ID}) на первой сессии была тревога, затем стало спокойнее.`);
    expect(out).toBe("У клиентки Анна на первой сессии была тревога, затем стало спокойнее.");
  });
  it("если после очистки почти ничего не осталось — fallback", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(guardResponseText(ID)).toContain("Не удалось сформировать ответ");
  });
  it("псевдо-вызов инструмента по-прежнему блокируется", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(guardResponseText("```search_knowledge_base\n{\"query\":\"x\"}```")).toContain("Не удалось сформировать ответ");
  });
});
