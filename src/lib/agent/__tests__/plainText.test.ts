import { describe, expect, it } from "vitest";
import { plainifyMarkdown } from "../plainText";

describe("plainifyMarkdown", () => {
  it("убирает заголовки, жирный и маркеры списков", () => {
    const md = "# Изменения\n\n## Первая сессия\n- **Причина**: давление мужа\n  - вложенный пункт\n\n---\n\nИтог: *важно*.";
    expect(plainifyMarkdown(md)).toBe("Изменения\n\nПервая сессия\n— Причина: давление мужа\n  — вложенный пункт\n\nИтог: важно.");
  });
  it("не трогает обычный текст и нумерацию", () => {
    const t = "1. Дыхание 4-7-8\n2. Дневник мыслей — три записи";
    expect(plainifyMarkdown(t)).toBe(t);
  });
});
