import { describe, it, expect } from "vitest";
import { generateAvailableSlots, isSlotAvailable, type WorkingHours } from "../booking";

const wh: WorkingHours = { wed: ["10:00", "13:00"] };
const base = {
  workingHours: wh,
  sessionDurationMinutes: 50,
  bufferMinutes: 10,
  minNoticeHours: 0,
  occupied: [],
  now: new Date("2026-10-01T00:00:00Z"),
  timeZone: "Europe/Moscow",
};
// 2026-10-28 — среда
describe("слоты на конкретные даты", () => {
  it("без правок — сетка по рабочим часам", () => {
    const s = generateAvailableSlots({ ...base, fromDate: "2026-10-28", toDate: "2026-10-28" });
    expect(s.map(x => x.time)).toEqual(["10:00", "11:00", "12:00"]);
  });
  it("свои времена заменяют сетку, любые минуты", () => {
    const s = generateAvailableSlots({ ...base, fromDate: "2026-10-28", toDate: "2026-10-28", dateOverrides: { "2026-10-28": ["15:00", "11:12", "11:12", "bad"] } });
    expect(s.map(x => x.time)).toEqual(["11:12", "15:00"]);
  });
  it("пустой массив закрывает день", () => {
    const s = generateAvailableSlots({ ...base, fromDate: "2026-10-28", toDate: "2026-10-28", dateOverrides: { "2026-10-28": [] } });
    expect(s).toEqual([]);
  });
  it("можно открыть слот в выходной по шаблону (четверг)", () => {
    const s = generateAvailableSlots({ ...base, fromDate: "2026-10-29", toDate: "2026-10-29", dateOverrides: { "2026-10-29": ["19:00"] } });
    expect(s.map(x => x.time)).toEqual(["19:00"]);
  });
  it("занятое окно по-прежнему вырезается", () => {
    const s = generateAvailableSlots({
      ...base, fromDate: "2026-10-28", toDate: "2026-10-28",
      dateOverrides: { "2026-10-28": ["11:00", "13:00"] },
      occupied: [{ start: "2026-10-28T08:00:00Z", end: "2026-10-28T08:50:00Z" }], // 11:00–11:50 МСК
    });
    expect(s.map(x => x.time)).toEqual(["13:00"]);
  });
  it("isSlotAvailable учитывает правки", () => {
    const p = { ...base, maxAdvanceDays: 60, date: "2026-10-29", time: "19:00" };
    expect(isSlotAvailable(p)).toBe(false);
    expect(isSlotAvailable({ ...p, dateOverrides: { "2026-10-29": ["19:00"] } })).toBe(true);
  });
});
