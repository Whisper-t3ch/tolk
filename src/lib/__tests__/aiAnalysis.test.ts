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

describe("итоги сессии (psyAI-блоки)", () => {
  it("достаёт все блоки, регистр и вложенность ключей не страшны", async () => {
    const { normalizeAnalysis, SESSION_KEYS } = await import("../prompts/aiAnalysis");
    const out = normalizeAnalysis(
      { Итоги: { State_Score: 7, strengths: ["Эмпатия", "Рефрейминг"], supports: "Ресурс: гибкость", growth: "Телесность", alliance: "Контакт тёплый", interventions: "Рефрейминг: высокая", identity: "Наставник" } },
      SESSION_KEYS
    );
    expect(out.strengths).toBe("— Эмпатия\n— Рефрейминг");
    expect(out.alliance).toBe("Контакт тёплый");
    expect(out.identity).toBe("Наставник");
    expect(out.homework).toBe("");
  });
});
