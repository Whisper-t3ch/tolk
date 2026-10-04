import { describe, it, expect } from "vitest";
import { guardSoapDraft, parseSoapJson, NO_DATA_FIELD_TEXT } from "../groundedness";

const SOURCE = `Психолог: Здравствуйте, Анна. Как прошла неделя?
Клиент: Тяжело, я плохо сплю, просыпаюсь в три часа ночи и не могу уснуть, тревога сильная, примерно шесть баллов из десяти.
Психолог: Вы выполнили задание с дневником сна?
Клиент: Да, записывала каждый вечер, ссора с мамой сильно выбила меня из колеи.
Психолог: Договоримся, что продолжите вести дневник сна, а на следующей встрече разберём ссору с мамой.
Сессия №3`;

describe("guardSoapDraft", () => {
  it("оставляет разделы, подтверждённые записью", () => {
    const draft = {
      s: "Клиентка плохо спит, просыпается ночью и не может уснуть; отмечает сильную тревогу.",
      o: "Дневник сна вела каждый вечер. Тревогу оценила примерно в шесть баллов из десяти.",
      a: "Недостаточно данных",
      p: "Продолжить вести дневник сна; на следующей встрече разобрать ссору с мамой.",
    };
    const { result, issues } = guardSoapDraft(draft, SOURCE);
    expect(issues).toEqual([]);
    expect(result.s).toBe(draft.s);
    expect(result.p).toBe(draft.p);
    expect(result.a).toBe("Недостаточно данных");
  });

  it("заменяет выдуманное домашнее задание", () => {
    const source = "Клиент: Что-то не успеваю ничего делать особо, нет времени вообще ни на что.";
    const { result, issues } = guardSoapDraft(
      { s: "Клиент не успевает делать дела.", o: "Недостаточно данных", a: "Недостаточно данных", p: "Вести дневник времени и фиксировать, на что уходит день." },
      source
    );
    expect(result.p).toBe(NO_DATA_FIELD_TEXT);
    expect(issues).toContainEqual({ block: "p", kind: "unsupported_homework" });
  });

  it("заменяет выдуманный диагноз и рекомендации", () => {
    const { result, issues } = guardSoapDraft(
      { s: "Плохо спит.", o: "Недостаточно данных", a: "Возможно тревожное расстройство, депрессия.", p: "Рекомендуется консультация психиатра." },
      SOURCE
    );
    expect(result.a).toBe(NO_DATA_FIELD_TEXT);
    expect(result.p).toBe(NO_DATA_FIELD_TEXT);
    expect(issues.map(i => i.kind)).toEqual(expect.arrayContaining(["unsupported_diagnosis", "unsupported_recommendation"]));
  });

  it("заменяет выдуманные числа, но принимает цифру вместо числительного из записи", () => {
    const bad = guardSoapDraft({ s: "Тревога 8 баллов из 10.", o: "Недостаточно данных", a: "Недостаточно данных", p: "Недостаточно данных" }, SOURCE);
    expect(bad.issues).toContainEqual({ block: "s", kind: "unsupported_number" });
    const ok = guardSoapDraft({ s: "Просыпается в 3 часа ночи, тревога около 6 баллов.", o: "Недостаточно данных", a: "Недостаточно данных", p: "Недостаточно данных" }, SOURCE);
    expect(ok.issues).toEqual([]);
  });

  it("заменяет выдуманную цитату, принимает дословную", () => {
    const fake = guardSoapDraft({ s: "Клиентка сказала: «я больше не могу так жить дальше»", o: "Недостаточно данных", a: "Недостаточно данных", p: "Недостаточно данных" }, SOURCE);
    expect(fake.issues).toContainEqual({ block: "s", kind: "unsupported_quote" });
    const real = guardSoapDraft({ s: "Клиентка: «просыпаюсь в три часа ночи и не могу уснуть»", o: "Недостаточно данных", a: "Недостаточно данных", p: "Недостаточно данных" }, SOURCE);
    expect(real.issues).toEqual([]);
  });

  it("заменяет раздел, почти не пересекающийся с записью (общие домыслы)", () => {
    const source = "Клиент: Что-то не успеваю ничего делать особо. Так, как бы мне открыть мысли?";
    const { result, issues } = guardSoapDraft(
      {
        s: "Клиент сообщает о проблемах с организацией времени.",
        o: "Недостаточно данных",
        a: "Можно предположить проблемы с тайм-менеджментом и организацией мыслительного процесса, необходимо выяснить причины нехватки времени.",
        p: "Недостаточно данных",
      },
      source
    );
    expect(result.a).toBe(NO_DATA_FIELD_TEXT);
    expect(issues).toContainEqual({ block: "a", kind: "low_overlap" });
  });

  it("не-строковое поле заменяется и отмечается", () => {
    const { result, issues } = guardSoapDraft({ s: "Плохо спит и просыпается ночью.", o: 5, a: undefined, p: null } as never, SOURCE);
    expect(result.o).toBe(NO_DATA_FIELD_TEXT);
    expect(issues.filter(i => i.kind === "invalid_field").map(i => i.block)).toEqual(["o", "a", "p"]);
  });
});

describe("parseSoapJson", () => {
  it("разбирает JSON с markdown-обёрткой", () => {
    expect(parseSoapJson('```json\n{"s":"a","o":"b","a":"c","p":"d"}\n```')).toEqual({ s: "a", o: "b", a: "c", p: "d" });
  });
  it("бросает ошибку на не-JSON", () => {
    expect(() => parseSoapJson("Я не могу обсуждать эту тему")).toThrow();
  });
});
