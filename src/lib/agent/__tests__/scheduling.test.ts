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
