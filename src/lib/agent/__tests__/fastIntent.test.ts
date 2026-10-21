import { describe, it, expect } from "vitest";
import { parseFastIntent } from "../fastIntent";
import { expandSessionStarts, formatSessionStart } from "../scheduling";

const TZ = "Europe/Moscow";
// Среда, 21 октября 2026, 12:00 МСК
const NOW = new Date("2026-10-21T09:00:00Z");
const anna = { id: "a1", name: "Анна Иванова" };
const ctx = (clients = [anna]) => ({ clients, timeZone: TZ, now: NOW });

describe("fastIntent: клиенты", () => {
  it("список имён", () => {
    expect(parseFastIntent("Создай 5 клиентов: Алексей, Юлия, Мария, Сергей и Иван", ctx([]))).toEqual({
      tool: "create_client",
      args: { names: ["Алексей", "Юлия", "Мария", "Сергей", "Иван"] },
    });
  });
  it("одно имя с фамилией", () => {
    expect(parseFastIntent("добавь клиента Иван Петров", ctx([]))).toEqual({ tool: "create_client", args: { names: ["Иван Петров"] } });
  });
  it("с запросом или сессией — модели", () => {
    expect(parseFastIntent("Создай клиента Олю и сразу поставь ей сессию", ctx([]))).toBeNull();
    expect(parseFastIntent("Добавь клиента Олю с запросом тревожность", ctx([]))).toBeNull();
  });
  it("обычная фраза не список имён", () => {
    expect(parseFastIntent("создай клиента который давно ко мне ходит", ctx([]))).toBeNull();
  });
});

describe("fastIntent: сессии", () => {
  const first = (msg: string, clients = [anna]) => {
    const r = parseFastIntent(msg, ctx(clients));
    if (!r || r.tool !== "create_session") return null;
    return expandSessionStarts(r.args, TZ, NOW).map(d => formatSessionStart(d, TZ));
  };
  it("завтра в 10", () => {
    expect(first("Поставь Анну на завтра в 10")).toEqual(["чт, 22 октября, 10:00"]);
  });
  it("в пятницу в 15:30", () => {
    expect(first("Создай сессию с Анной в пятницу в 15:30")).toEqual(["пт, 23 октября, 15:30"]);
  });
  it("25 октября в 9 вечера", () => {
    expect(first("запиши Анну на 25 октября в 9 вечера")).toEqual(["вс, 25 октября, 21:00"]);
  });
  it("25.10 в 14:00", () => {
    expect(first("поставь сессию с Анной 25.10 в 14:00")).toEqual(["вс, 25 октября, 14:00"]);
  });
  it("по вторникам в 12 и пятницам в 17 до конца ноября", () => {
    const r = first("Создай сессии с Анной по вторникам в 12 и пятницам в 17 до конца ноября")!;
    expect(r.slice(0, 3)).toEqual(["пт, 23 октября, 17:00", "вт, 27 октября, 12:00", "пт, 30 октября, 17:00"]);
    expect(r[r.length - 1]).toBe("пт, 27 ноября, 17:00");
  });
  it("во вторник и пятницу в 11 — по одной на день", () => {
    expect(first("Поставь Анне сессии во вторник и пятницу в 11")).toEqual(["пт, 23 октября, 11:00", "вт, 27 октября, 11:00"]);
  });
  it("нет времени, клиента или дата непонятна — null", () => {
    expect(parseFastIntent("Поставь Анну на завтра", ctx())).toBeNull();
    expect(parseFastIntent("Поставь сессию на завтра в 10", ctx([]))).toBeNull();
    expect(parseFastIntent("Поставь Анну в 10", ctx())).toBeNull();
  });
  it("отмена, вопросы и перенос — модели", () => {
    expect(parseFastIntent("Отмени сессию с Анной завтра в 10", ctx())).toBeNull();
    expect(parseFastIntent("Когда у Анны ближайшая сессия?", ctx())).toBeNull();
    expect(parseFastIntent("Перенеси Анну на завтра в 11", ctx())).toBeNull();
  });
});

import { messageHasTime, explicitDate } from "../fastIntent";
describe("время и дата в просьбе", () => {
  it("время названо", () => {
    expect(messageHasTime("Поставь Егора на завтра в 10")).toBe(true);
    expect(messageHasTime("поставь на 15:30")).toBe(true);
    expect(messageHasTime("завтра в десять")).toBe(true);
    expect(messageHasTime("Поставь Егора на завтра")).toBe(false);
    expect(messageHasTime("Поставь Егора на 25 октября")).toBe(false);
  });
  it("явная дата", () => {
    expect(explicitDate("Отмени сессию 1 января", TZ, NOW)).toBe("2027-01-01");
    expect(explicitDate("Отмени сессию с Егором", TZ, NOW)).toBeNull();
  });
});
