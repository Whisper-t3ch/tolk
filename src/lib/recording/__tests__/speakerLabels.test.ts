import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/yandexgpt", async () => {
  const actual = await vi.importActual<typeof import("@/lib/yandexgpt")>("@/lib/yandexgpt");
  return { ...actual, yandexGptCompleteJson: vi.fn() };
});
import { yandexGptCompleteJson } from "@/lib/yandexgpt";
import { buildTurns, labelSpeakers, SPEAKER_NOTE } from "../speakerLabels";
import { labelAnonymizedText } from "../uploadedAudio";

const llm = vi.mocked(yandexGptCompleteJson);

describe("speakerLabels", () => {
  beforeEach(() => { llm.mockReset(); });

  it("склеивает подряд идущие фрагменты одного говорящего", () => {
    expect(buildTurns(["Как вы?", "Что вас беспокоит?", "Плохо сплю.", "Давно?"], ["Психолог", "Психолог", "Клиент", "Психолог"])).toBe(
      "Психолог: Как вы? Что вас беспокоит?\n\nКлиент: Плохо сплю.\n\nПсихолог: Давно?"
    );
  });

  it("размечает по ответу модели", async () => {
    llm.mockResolvedValue({ speakers: ["П", "К", "п"] });
    expect(await labelSpeakers(["Здравствуйте", "Привет", "Как дела?"])).toEqual(["Психолог", "Клиент", "Психолог"]);
  });

  it("неверное число меток — повтор, затем null", async () => {
    llm.mockResolvedValue({ speakers: ["П"] });
    expect(await labelSpeakers(["a", "b", "c"])).toBeNull();
    expect(llm).toHaveBeenCalledTimes(2);
  });

  it("сбой модели — null, текст не теряется", async () => {
    llm.mockRejectedValue(new Error("moderation"));
    expect(await labelSpeakers(["a", "b"])).toBeNull();
    const out = await labelAnonymizedText("Здравствуйте\nПривет");
    expect(out).toBe("Здравствуйте\n\nПривет");
  });

  it("с разметкой добавляется пометка об автоматической разметке", async () => {
    llm.mockResolvedValue({ speakers: ["П", "К"] });
    const out = await labelAnonymizedText("Здравствуйте\nПривет");
    expect(out).toBe(`${SPEAKER_NOTE}\n\nПсихолог: Здравствуйте\n\nКлиент: Привет`);
  });

  it("длинный текст делится на пачки по 40", async () => {
    const units = Array.from({ length: 95 }, (_, i) => `фраза ${i}`);
    llm.mockImplementation(async (msgs: unknown) => {
      const user = (msgs as Array<{ text: string }>)[1].text;
      const n = (user.split("Размечай:")[1].match(/^\d+\./gm) ?? []).length;
      return { speakers: Array.from({ length: n }, (_, i) => (i % 2 ? "К" : "П")) };
    });
    const labels = await labelSpeakers(units);
    expect(labels).toHaveLength(95);
    expect(llm).toHaveBeenCalledTimes(3);
  });
});
