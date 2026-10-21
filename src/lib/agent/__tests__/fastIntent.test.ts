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

describe("личные события", () => {
  it("тренировки не становятся сессией", () => {
    expect(parseFastIntent("Поставь Анну на тренировку завтра в 10", ctx())).toBeNull();
    expect(parseFastIntent("Заполни расписание обедом во вторник в 13", ctx())).toBeNull();
  });
});

describe("клиент и сразу сессия", () => {
  it("создай клиента Олю и сразу поставь ей сессию в пятницу в 11", () => {
    const r = parseFastIntent("Создай клиента Олю и сразу поставь ей сессию в пятницу в 11", ctx([]));
    expect(r).not.toBeNull();
    if (!r || r.tool !== "create_client") throw new Error("ждали create_client");
    expect(r.args.names).toEqual(["Олю"]);
    const starts = expandSessionStarts({ ...r.args.then_session!, client_id: undefined }, TZ, NOW).map(d => formatSessionStart(d, TZ));
    expect(starts).toEqual(["пт, 23 октября, 11:00"]);
  });
  it("без времени — модели, как раньше", () => {
    expect(parseFastIntent("Создай клиента Олю и сразу поставь ей сессию в пятницу", ctx([]))).toBeNull();
  });
});

describe("несколько разных дат", () => {
  it("завтра и пятница — модели", () => {
    expect(parseFastIntent("Поставь Анну на завтра в 11 и в пятницу в 12", ctx())).toBeNull();
    expect(parseFastIntent("Поставь Анну на 25 октября в 10 и 26 октября в 11", ctx())).toBeNull();
  });
  it("одна дата с одним временем по-прежнему быстро", () => {
    expect(parseFastIntent("Поставь Анну на 25 октября в 10", ctx())).not.toBeNull();
  });
});

describe("личные события", () => {
  const days = (r: ReturnType<typeof parseFastIntent>) => {
    if (!r || r.tool !== "create_personal_event") throw new Error("не личное событие");
    return expandSessionStarts(r.args, TZ, NOW).map(d => formatSessionStart(d, TZ));
  };
  it("одно событие на завтра", () => {
    const r = parseFastIntent("Поставь мне тренировку завтра в 19:00", ctx());
    expect(r).toMatchObject({ tool: "create_personal_event", args: { title: "Тренировка", date: "2026-10-22", time: "19:00" } });
  });
  it("с открытой карточкой клиента всё равно личное событие", () => {
    expect(parseFastIntent("Добавь обед завтра в 13", ctx())?.tool).toBe("create_personal_event");
  });
  it("диапазон времени задаёт длительность", () => {
    const r = parseFastIntent("Добавь в календарь тренировку в пятницу с 18 до 19:30", ctx());
    expect(r).toMatchObject({ tool: "create_personal_event", args: { time: "18:00", duration_minutes: 90 } });
  });
  it("«на 2 часа»", () => {
    expect(parseFastIntent("Запиши зал завтра в 8 на 2 часа", ctx())).toMatchObject({ args: { time: "08:00", duration_minutes: 120 } });
  });
  it("заполни расписание: серия на месяц", () => {
    const r = parseFastIntent("Заполни моё расписание тренировками во вторник и пятницу в 11 на месяц", ctx());
    expect(r?.tool).toBe("create_personal_event");
    expect(days(r)).toHaveLength(8);
  });
  it("по вторникам в 19 до конца месяца", () => {
    const r = parseFastIntent("Поставь тренировки по вторникам в 19:00 до конца октября", ctx());
    expect(days(r)).toEqual(expect.arrayContaining([expect.stringContaining("27 октября")]));
  });
  it("в кавычках — своё название", () => {
    expect(parseFastIntent("Добавь событие «Встреча с подругой» в субботу в 15:00", ctx())).toMatchObject({ args: { title: "Встреча с подругой" } });
  });
  it("клиент или сессия — не личное событие", () => {
    expect(parseFastIntent("Поставь Анне сессию завтра в 11", ctx())?.tool).toBe("create_session");
    expect(parseFastIntent("Запиши Анну на тренировку завтра в 11", ctx())).toBeNull();
  });
  it("без времени — модели", () => {
    expect(parseFastIntent("Добавь тренировку завтра", ctx())).toBeNull();
  });
  it("две разные даты — модели", () => {
    expect(parseFastIntent("Добавь тренировку завтра в 19 и в пятницу в 20", ctx())).toBeNull();
  });
});
