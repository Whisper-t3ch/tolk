import { describe, it, expect } from "vitest";
import { maskProfanity, containsProfanity, PROFANITY_MARKER } from "../profanity";

describe("maskProfanity", () => {
  it("маскирует основные формы мата маркером", () => {
    expect(maskProfanity("Да это полное говно, блядь")).toBe(`Да это полное ${PROFANITY_MARKER}, ${PROFANITY_MARKER}`);
    expect(maskProfanity("он меня заебал")).toBe(`он меня ${PROFANITY_MARKER}`);
    expect(maskProfanity("пошёл нахуй")).toBe(`пошёл ${PROFANITY_MARKER}`);
    expect(maskProfanity("Ёбаный стыд, какая сука")).toBe(`${PROFANITY_MARKER} стыд, какая ${PROFANITY_MARKER}`);
    expect(maskProfanity("ПИЗДЕЦ")).toBe(PROFANITY_MARKER);
  });

  it("не трогает обычные слова, похожие по написанию", () => {
    const safe = "Я хлеб купил себе, ребёнок требует внимания, небо серое, употреблять нельзя, хуже стало, херувим, сукно, оскорбление, лебедь";
    expect(maskProfanity(safe)).toBe(safe);
    expect(containsProfanity(safe)).toBe(false);
  });

  it("сохраняет пунктуацию, пробелы и регистр остального текста", () => {
    expect(maskProfanity("Ну... Бля! Это, Конечно, ТАК.")).toBe(`Ну... ${PROFANITY_MARKER}! Это, Конечно, ТАК.`);
  });

  it("пустой и пробельный ввод не ломается", () => {
    expect(maskProfanity("")).toBe("");
    expect(maskProfanity("   ")).toBe("   ");
  });

  it("containsProfanity находит мат", () => {
    expect(containsProfanity("он вообще мудак")).toBe(true);
  });
});

describe("maskProfanity: расширенный список", () => {
  it("маскирует хрен/жопа/дерьмо/мразь и не трогает обычные слова", () => {
    expect(maskProfanity("пошёл нахрен, какая жопа, дерьмо, мразь")).toBe(
      `пошёл ${PROFANITY_MARKER}, какая ${PROFANITY_MARKER}, ${PROFANITY_MARKER}, ${PROFANITY_MARKER}`
    );
    const safe = "хренология не слово, а вот жизнь, правда, мрак, падение, гнездо, срок, срочно";
    expect(maskProfanity(safe)).toBe(safe);
  });
});
