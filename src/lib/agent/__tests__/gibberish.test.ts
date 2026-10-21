import { describe, it, expect } from "vitest";
import { looksLikeGibberish } from "../gibberish";

describe("looksLikeGibberish", () => {
  it("ловит случайные наборы", () => {
    for (const m of ["рдлллллллллллл", "тибиоию", "пвр рполллд", "asdfgh", "ффффф"]) expect(looksLikeGibberish(m), m).toBe(true);
  });
  it("не трогает нормальные короткие реплики", () => {
    for (const m of ["да", "ок", "привет", "спасибо", "Что с Артёмом?", "подготовь к сессии", "тревога", "здравствуйте", "встреча", "дневник"]) expect(looksLikeGibberish(m), m).toBe(false);
  });
});
