import { describe, expect, it } from "vitest";
import { looksLikeDiagnosis } from "../diagnosisGuard";

describe("looksLikeDiagnosis", () => {
  it("ловит постановку диагноза", () => {
    expect(looksLikeDiagnosis("По представленным данным можно предположить наличие генерализованного тревожного расстройства (ГТР)")).toBe(true);
    expect(looksLikeDiagnosis("Симптомы соответствуют депрессии.")).toBe(true);
    expect(looksLikeDiagnosis("Да, это ГТР.")).toBe(true);
  });
  it("не трогает отказ и обычные ответы", () => {
    expect(looksLikeDiagnosis("По описанию диагноз не ставлю. Можно применить шкалу HADS для оценки тревоги и депрессии.")).toBe(false);
    expect(looksLikeDiagnosis("Катя рассказала о маме и о срывах на дочь.")).toBe(false);
  });
});
