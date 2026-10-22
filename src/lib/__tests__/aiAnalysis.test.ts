import { describe, it, expect } from "vitest";
import { normalizeAnalysis, parseScore } from "../prompts/aiAnalysis";

describe("normalizeAnalysis", () => {
  it("берёт ключи как есть и превращает списки в строки", () => {
    const r = normalizeAnalysis({ summary: "ок", dynamics: ["a", "b"] }, ["summary", "dynamics", "interpretation"]);
    expect(r.summary).toBe("ок");
    expect(r.dynamics).toBe("— a\n— b");
    expect(r.interpretation).toBe("");
  });
  it("разворачивает обёртку и регистр ключей", () => {
    const r = normalizeAnalysis({ result: { Summary: "x", "Next Focus": "y" } }, ["summary", "next_focus"]);
    expect(r.summary).toBe("x");
    expect(r.next_focus).toBe("y");
  });
});

describe("parseScore", () => {
  it("число, запятая, диапазон", () => {
    expect(parseScore("7")).toBe(7);
    expect(parseScore("6,5 из 10")).toBe(6.5);
    expect(parseScore("15")).toBe(10);
    expect(parseScore("нет")).toBeNull();
  });
});
