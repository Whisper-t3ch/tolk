import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/yandexgpt", async () => {
  const actual = await vi.importActual<typeof import("@/lib/yandexgpt")>("@/lib/yandexgpt");
  return { ...actual, yandexGptCompleteJson: vi.fn() };
});

import { yandexGptCompleteJson } from "@/lib/yandexgpt";
import { anonymizeLongText, splitForAnonymization } from "../anonymize";

const mocked = vi.mocked(yandexGptCompleteJson);

describe("splitForAnonymization", () => {
  it("короткий текст остаётся одним куском", () => {
    expect(splitForAnonymization("Психолог: Здравствуйте.\nКлиент: Привет.", 2500)).toEqual(["Психолог: Здравствуйте.\nКлиент: Привет."]);
  });
  it("длинный текст режется по строкам, ни один кусок не длиннее лимита, ничего не теряется", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `Клиент: реплика номер ${i} с некоторым текстом для объёма.`);
    const chunks = splitForAnonymization(lines.join("\n"), 500);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(500);
    expect(chunks.join("\n")).toBe(lines.join("\n"));
  });
  it("сплошной текст без переносов режется по предложениям, а гигантское предложение — жёстко", () => {
    const sentence = "Это предложение. ".repeat(300).trim();
    const chunks = splitForAnonymization(sentence, 400);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(400);
    expect(splitForAnonymization("а".repeat(1300), 500).map(c => c.length)).toEqual([500, 500, 300]);
  });
});

describe("anonymizeLongText", () => {
  beforeEach(() => {
    mocked.mockReset();
    mocked.mockResolvedValue({ replacements: [] });
  });
  it("длинный транскрипт уходит несколькими запросами и собирается в исходном порядке", async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `Клиент: реплика ${i} про работу и сон, ничего личного.`);
    const text = lines.join("\n");
    const out = await anonymizeLongText(text, "Анна", { retryDelayMs: 0 });
    expect(out).toBe(text);
    expect(mocked.mock.calls.length).toBeGreaterThan(3);
  });
});
