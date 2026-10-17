import { describe, expect, it } from "vitest";
import { looksLikeDiagnosis } from "../diagnosisGuard";

// Реальные формулировки GigaChat со стенда (16.10).
describe("looksLikeDiagnosis: живые ответы", () => {
  it("«симптомы, характерные для ГТР» — привязка к диагнозу", () => {
    expect(looksLikeDiagnosis("Однако у Анны присутствуют следующие симптомы, характерные для ГТР:\n— Постоянное беспокойство")).toBe(true);
  });
  it("«симптомы, которые могут соответствовать ГТР» (Cloud.ru, GigaChat-3-Pro)", () => {
    expect(looksLikeDiagnosis("но по описанию у Анны есть симптомы, которые могут соответствовать генерализованному тревожному расстройству: тревога")).toBe(true);
  });
});
