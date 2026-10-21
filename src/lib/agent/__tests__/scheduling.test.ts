import { describe, it, expect } from "vitest";
import { expandSessionStarts, formatSessionStart, collectClientNames } from "../scheduling";

const TZ = "Europe/Moscow";
// Среда, 21 октября 2026, 12:00 по Москве
const NOW = new Date("2026-10-21T09:00:00Z");

describe("expandSessionStarts", () => {
  it("«по вторникам в 15:00 до конца месяца» → вторники октября в 15:00 МСК", () => {
    const r = expandSessionStarts({ weekday: "tue", time: "15:00", repeat_until: "end_of_month" }, TZ, NOW);
    expect(r.map(d => d.toISOString())).toEqual(["2026-10-27T12:00:00.000Z"]);
    expect(formatSessionStart(r[0], TZ)).toMatch(/^вт, 27 октября, 15:00$/);
  });
  it("повтор до даты", () => {
    const r = expandSessionStarts({ weekday: "вторник", time: "15:00", repeat_until: "2026-11-24" }, TZ, NOW);
    expect(r).toHaveLength(5);
    expect(r[4].toISOString()).toBe("2026-11-24T12:00:00.000Z");
  });
  it("datetime с Z трактуется как местное время", () => {
    const r = expandSessionStarts({ datetime: "2026-10-22T15:00:00.000Z" }, TZ, NOW);
    expect(r[0].toISOString()).toBe("2026-10-22T12:00:00.000Z");
  });
  it("прошедшая дата — ошибка", () => {
    expect(() => expandSessionStarts({ date: "2026-10-20", time: "10:00" }, TZ, NOW)).toThrow();
  });
});

describe("collectClientNames", () => {
  it("разбирает список", () => {
    expect(collectClientNames({ names: ["Алексей", "Юлия"], name: "Иван" })).toEqual(["Алексей", "Юлия", "Иван"]);
    expect(collectClientNames({ name: "Мария, Сергей и Иван" })).toEqual(["Мария", "Сергей", "Иван"]);
  });
});

import { inferRecurrence } from "../scheduling";
describe("inferRecurrence", () => {
  it("«на месяц по вторникам» → 4 недели", () => {
    const a: { weekday: string; time: string; repeat_count?: number } = { weekday: "tue", time: "15:00" };
    inferRecurrence("Сделай встречи с Анной на месяц по вторникам в 15:00", a);
    expect(a.repeat_count).toBe(4);
  });
  it("разовая сессия не трогается", () => {
    const a: { time: string; repeat_count?: number; repeat_until?: string } = { time: "10:00" };
    inferRecurrence("Поставь сессию с Дмитрием на завтра на 10 часов", a);
    expect(a.repeat_count).toBeUndefined();
    expect(a.repeat_until).toBeUndefined();
  });
  it("до конца месяца", () => {
    const a: { repeat_until?: string } = {};
    inferRecurrence("каждую пятницу в 12 до конца месяца", a);
    expect(a.repeat_until).toBe("end_of_month");
  });
});

describe("несколько дней недели", () => {
  it("пн и ср до 30 ноября: все пн и ср, по порядку", () => {
    const a: { weekday?: string; time: string; repeat_until?: string } = { weekday: "mon", time: "18:00", repeat_until: "2026-11-30" };
    inferRecurrence("Встречи по понедельникам и средам в 18:00 до конца ноября", a);
    expect(a.weekday).toBe("mon,wed");
    const r = expandSessionStarts(a, TZ, NOW);
    expect(r.map(d => formatSessionStart(d, TZ)).slice(0, 4)).toEqual(["ср, 21 октября, 18:00", "пн, 26 октября, 18:00", "ср, 28 октября, 18:00", "пн, 2 ноября, 18:00"]);
    expect(r.length).toBeGreaterThan(10);
  });
  it("«среди недели» не считается средой", () => {
    const a: { weekday?: string; time: string } = { time: "10:00" };
    inferRecurrence("Каждый день среди недели в 10", a);
    expect(a.weekday).toBeUndefined();
  });
});

describe("до конца месяца", () => {
  it("перекрывает дату, посчитанную моделью", () => {
    const a: { weekday: string; time: string; repeat_until?: string } = { weekday: "wed", time: "10:00", repeat_until: "2026-11-04" };
    inferRecurrence("Каждую среду в 10 до конца месяца встречи", a);
    expect(a.repeat_until).toBe("end_of_month");
  });
});
