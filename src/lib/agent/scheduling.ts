// ------------------------------------------------------------
// Разворачивание аргументов create_session в конкретные даты.
//
// Слабые модели плохо считают дни недели и путают часовой пояс (отдавали
// «15:00» с суффиксом Z, и сессия уезжала на 3 часа; «по вторникам»
// превращалось в одну сессию на среду). Поэтому модель передаёт только
// смысл — день недели, местное время, до какой даты повторять, — а
// конкретные даты считает сервер в часовом поясе психолога.
// ------------------------------------------------------------

import { zonedDateTimeToUtc, formatDateInTimeZone, todayInTimeZone, weekdayInTimeZone } from "@/lib/timezone";

export interface CreateSessionArgs {
  client_id?: string;
  /** Устаревший формат. Время трактуется как местное время психолога, если нет явного смещения (+03:00). */
  datetime?: string;
  /** YYYY-MM-DD, местная дата психолога. */
  date?: string;
  /** HH:MM, местное время психолога. */
  time?: string;
  /** День недели: mon..sun (или по-русски). Для «по вторникам» без даты. */
  weekday?: string;
  /** Повторять раз в неделю до даты YYYY-MM-DD включительно, либо "end_of_month". */
  repeat_until?: string;
  /** Сколько всего сессий (с первой), если нужно повторение раз в неделю. */
  repeat_count?: number;
  duration_minutes?: number;
  /** Разное время в разные дни недели: «по вторникам в 12 и пятницам в 17». Заполняет сервер по тексту просьбы. */
  schedule?: Array<{ weekday: string; time: string }>;
}

export const MAX_SESSIONS_PER_REQUEST = 26;

const WEEKDAY_CODES: Record<string, number> = {
  sun: 0, sunday: 0, вс: 0, воскресенье: 0,
  mon: 1, monday: 1, пн: 1, понедельник: 1,
  tue: 2, tuesday: 2, вт: 2, вторник: 2,
  wed: 3, wednesday: 3, ср: 3, среда: 3,
  thu: 4, thursday: 4, чт: 4, четверг: 4,
  fri: 5, friday: 5, пт: 5, пятница: 5,
  sat: 6, saturday: 6, сб: 6, суббота: 6,
};

export function parseWeekday(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/[.,]/g, "");
  if (key in WEEKDAY_CODES) return WEEKDAY_CODES[key];
  // «вторникам», «вторника» и т.п. — сверяем по основе слова
  for (const [name, code] of Object.entries(WEEKDAY_CODES)) {
    if (name.length >= 5 && key.startsWith(name.slice(0, 5))) return code;
  }
  return null;
}

export function parseWeekdays(raw: unknown): number[] {
  if (typeof raw !== "string") return [];
  const out: number[] = [];
  for (const part of raw.split(/[\s,;/]+|\s+и\s+/)) {
    const code = parseWeekday(part);
    if (code !== null && !out.includes(code)) out.push(code);
  }
  return out;
}

function normalizeTime(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^(\d{1,2})[:.\s]?(\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function endOfMonth(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Возвращает моменты начала сессий (UTC), отсортированные по возрастанию. Бросает Error с понятным текстом. */
export function expandSessionStarts(args: CreateSessionArgs, timeZone: string, now: Date = new Date()): Date[] {
  const today = todayInTimeZone(timeZone, now);
  let time = normalizeTime(args.time);
  let date = typeof args.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : null;

  // Явное смещение в datetime — единственный случай, когда доверяем ему как моменту времени.
  if (!date && typeof args.datetime === "string") {
    const dt = args.datetime.trim();
    const explicit = dt.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?([+-]\d{2}:?\d{2})$/);
    if (explicit) {
      const d = new Date(dt);
      if (!Number.isNaN(d.getTime())) {
        date = formatDateInTimeZone(d, timeZone);
        time = time ?? normalizeTime(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d));
      }
    } else {
      const m = dt.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
      if (m) {
        date = m[1];
        time = time ?? (m[2] ? m[2] : null);
      }
    }
  }

  const slots = Array.isArray(args.schedule)
    ? args.schedule
        .map(x => ({ wd: parseWeekday(x?.weekday), time: normalizeTime(x?.time) }))
        .filter((x): x is { wd: number; time: string } => x.wd !== null && x.time !== null)
    : [];
  if (slots.length > 1) return expandSlots(slots, args, date, timeZone, now, today);

  if (!time) throw new Error("не указано время сессии");

  const wds = parseWeekdays(args.weekday);
  if (!date) {
    if (wds.length === 0) throw new Error("не указана дата: на какой день поставить сессию");
    date = today;
  }
  const weekdayOf = (d: string) => weekdayInTimeZone(zonedDateTimeToUtc(d, "12:00", timeZone), timeZone);
  // Если задан день (или несколько) — сдвигаем дату вперёд до ближайшего подходящего дня (включая саму дату).
  if (wds.length) {
    for (let i = 0; i < 7; i++) {
      const probe = addDays(date, i);
      if (wds.includes(weekdayOf(probe))) {
        date = probe;
        break;
      }
    }
  }

  let until: string | null = null;
  if (typeof args.repeat_until === "string") {
    const ru = args.repeat_until.trim().toLowerCase();
    if (ru === "end_of_month" || ru === "month") until = endOfMonth(date);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(ru)) until = ru;
  }
  const count =
    typeof args.repeat_count === "number" && args.repeat_count > 1 ? Math.min(Math.floor(args.repeat_count), MAX_SESSIONS_PER_REQUEST) : null;

  const dates: string[] = [];
  if (!until && !count) {
    dates.push(date);
  } else {
    // Идём по дням: с несколькими днями недели («пн и ср») берём каждый подходящий день, иначе — раз в 7 дней.
    for (let i = 0; i < 7 * MAX_SESSIONS_PER_REQUEST && dates.length < MAX_SESSIONS_PER_REQUEST; i++) {
      const d = addDays(date, i);
      if (until && d > until) break;
      if (count && dates.length >= count) break;
      const matches = wds.length ? wds.includes(weekdayOf(d)) : i % 7 === 0;
      if (matches) dates.push(d);
    }
  }

  const starts = dates.map(d => zonedDateTimeToUtc(d, time as string, timeZone));
  // Прошедшие даты не создаём (например, «весь месяц», когда месяц уже идёт) — но разовую сессию в прошлом молча не режем.
  const upcoming = dates.length > 1 ? starts.filter(s => s.getTime() > now.getTime()) : starts;
  if (upcoming.length === 0) throw new Error("все эти даты уже прошли");
  if (upcoming.length === 1 && dates.length === 1 && upcoming[0].getTime() <= now.getTime()) {
    throw new Error("это время уже прошло");
  }
  return upcoming;
}

function resolveUntil(args: CreateSessionArgs, from: string): string | null {
  if (typeof args.repeat_until !== "string") return null;
  const ru = args.repeat_until.trim().toLowerCase();
  if (ru === "end_of_month" || ru === "month") return endOfMonth(from);
  return /^\d{4}-\d{2}-\d{2}$/.test(ru) ? ru : null;
}

/** Несколько дней недели с разным временем. Срок (until/count) общий: count — сколько всего сессий. */
function expandSlots(
  slots: Array<{ wd: number; time: string }>,
  args: CreateSessionArgs,
  date: string | null,
  timeZone: string,
  now: Date,
  today: string
): Date[] {
  const from = date ?? today;
  const until = resolveUntil(args, from);
  const count =
    typeof args.repeat_count === "number" && args.repeat_count > 1 ? Math.min(Math.floor(args.repeat_count), MAX_SESSIONS_PER_REQUEST) : null;
  const weekdayOf = (d: string) => weekdayInTimeZone(zonedDateTimeToUtc(d, "12:00", timeZone), timeZone);
  const all: Date[] = [];
  const recurring = Boolean(until || count);
  for (const slot of slots) {
    let first: string | null = null;
    for (let i = 0; i < 7; i++) {
      const probe = addDays(from, i);
      if (weekdayOf(probe) === slot.wd) {
        first = probe;
        break;
      }
    }
    if (!first) continue;
    if (!recurring) {
      all.push(zonedDateTimeToUtc(first, slot.time, timeZone));
      continue;
    }
    for (let w = 0; w < MAX_SESSIONS_PER_REQUEST; w++) {
      const d = addDays(first, 7 * w);
      if (until && d > until) break;
      all.push(zonedDateTimeToUtc(d, slot.time, timeZone));
    }
  }
  all.sort((a, b) => a.getTime() - b.getTime());
  const limited = count && !until ? all.slice(0, count) : all.slice(0, MAX_SESSIONS_PER_REQUEST);
  const upcoming = limited.filter(s => s.getTime() > now.getTime());
  if (upcoming.length === 0) throw new Error("все эти даты уже прошли");
  return upcoming;
}

const WD_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

/** «вт, 27 окт, 15:00» в часовом поясе психолога. */
export function formatSessionStart(d: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat("ru", { timeZone, day: "numeric", month: "long" }).format(d);
  const time = new Intl.DateTimeFormat("ru", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${WD_SHORT[weekdayInTimeZone(d, timeZone)]}, ${day}, ${time}`;
}

/** Ключ клиента-массива: name + names. Пустые и дубли убираем. */
export function collectClientNames(args: { name?: unknown; names?: unknown }): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v !== "string") return;
    // «Алексей, Юлия и Мария» в одной строке — разбиваем
    for (const part of v.split(/\s*(?:,|;|\n|\s+и\s+)\s*/)) {
      const t = part.trim().replace(/^[«"']+|[»"']+$/g, "");
      if (t && !out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t);
    }
  };
  if (Array.isArray(args.names)) args.names.forEach(push);
  push(args.name);
  return out.slice(0, 30);
}

const WEEKDAY_MENTIONS: Array<[string, RegExp]> = [
  ["mon", /(?<![а-яё])понедельник(?:ам|а|у|и)?(?![а-яё])/g],
  ["tue", /(?<![а-яё])вторник(?:ам|а|у|и)?(?![а-яё])/g],
  ["wed", /(?<![а-яё])сред(?:ам|а|у|ы)(?![а-яё])/g],
  ["thu", /(?<![а-яё])четверг(?:ам|а|у|и)?(?![а-яё])/g],
  ["fri", /(?<![а-яё])пятниц(?:ам|а|у|ы)(?![а-яё])/g],
  ["sat", /(?<![а-яё])суббот(?:ам|а|у|ы)(?![а-яё])/g],
  ["sun", /(?<![а-яё])воскресень(?:ям|е|я|ю)(?![а-яё])/g],
];

const MONTH_STEMS = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
const MONTH_RE = "(январ[ья]|феврал[ья]|марта?|апрел[ья]|ма[яй]|июн[ья]|июл[ья]|августа?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])";

function monthIndex(word: string): number {
  return MONTH_STEMS.findIndex(stem => word.startsWith(stem) && (stem !== "ма" || /^ма[яй]$/.test(word)));
}

/** «до конца ноября» / «до 30 ноября» / «до 30.11» → YYYY-MM-DD (ближайшее такое будущее). */
export function parseUntilFromText(text: string, timeZone: string, now: Date): string | null {
  const today = todayInTimeZone(timeZone, now);
  const [ty, tm, td] = today.split("-").map(Number);
  const pick = (month0: number, day: number | "end"): string => {
    let year = ty;
    const dayOf = (y: number) => (day === "end" ? new Date(Date.UTC(y, month0 + 1, 0)).getUTCDate() : day);
    if (month0 + 1 < tm || (month0 + 1 === tm && dayOf(year) < td)) year += 1;
    const d = dayOf(year);
    return `${year}-${String(month0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  const endM = text.match(new RegExp(`до\\s+конца\\s+${MONTH_RE}`));
  if (endM) {
    const mi = monthIndex(endM[1]);
    if (mi >= 0) return pick(mi, "end");
  }
  const dayM = text.match(new RegExp(`(?:до|по)\\s+(\\d{1,2})\\s+${MONTH_RE}`));
  if (dayM) {
    const mi = monthIndex(dayM[2]);
    const d = Number(dayM[1]);
    if (mi >= 0 && d >= 1 && d <= 31) return pick(mi, d);
  }
  const dotM = text.match(/(?:до|по)\s+(\d{1,2})\.(\d{2})(?!\d)/);
  if (dotM) {
    const d = Number(dotM[1]);
    const mo = Number(dotM[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return pick(mo - 1, d);
  }
  return null;
}

const TIME_IN_SEGMENT = new RegExp(
  `(?:^|[\\s,(])(?:в|к|около)?\\s*(\\d{1,2})(?:[:.](\\d{2}))(?!\\d)|(?:^|[\\s,(])(?:в|к)\\s+(\\d{1,2})(?![\\d:.])(?!\\s*(?:числ|${MONTH_RE.slice(1, -1)}))`
);

function timeFromSegment(segment: string): string | null {
  const m = segment.match(TIME_IN_SEGMENT);
  if (!m) return null;
  const h = Number(m[1] ?? m[3]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Дни недели в порядке упоминания вместе с временем, которое стоит рядом после названия дня. */
export function extractWeekdayTimes(text: string): Array<{ weekday: string; time: string | null }> {
  const hits: Array<{ code: string; start: number; end: number }> = [];
  for (const [code, re] of WEEKDAY_MENTIONS) {
    for (const m of text.matchAll(re)) hits.push({ code, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  hits.sort((a, b) => a.start - b.start);
  const out: Array<{ weekday: string; time: string | null }> = [];
  hits.forEach((h, i) => {
    if (out.some(o => o.weekday === h.code)) return;
    const next = hits[i + 1]?.start ?? text.length;
    out.push({ weekday: h.code, time: timeFromSegment(text.slice(h.end, next)) });
  });
  // День без своего времени берёт ближайшее следующее («во вторник и пятницу в 11»), а в конце — предыдущее.
  for (let i = out.length - 1; i >= 0; i--) if (!out[i].time && out[i + 1]?.time) out[i].time = out[i + 1].time;
  for (let i = 1; i < out.length; i++) if (!out[i].time && out[i - 1]?.time) out[i].time = out[i - 1].time;
  return out;
}

/**
 * Слабая модель часто забывает повторение («по вторникам на месяц» → одна сессия), теряет дни недели и путает
 * время у разных дней. Достраиваем всё это по тексту просьбы психолога.
 */
export function inferRecurrence(message: string, args: CreateSessionArgs, opts: { timeZone?: string; now?: Date } = {}): void {
  const timeZone = opts.timeZone ?? "Europe/Moscow";
  const now = opts.now ?? new Date();
  const hasRepeat = Boolean(args.repeat_until) || (typeof args.repeat_count === "number" && args.repeat_count > 1);
  const text = message.toLowerCase();
  const everyWeekday = /по\s+(понедельник|вторник|сред|четверг|пятниц|суббот|воскресень)\S*/.test(text);
  const every = /кажд(ый|ую|ое|ые)\s/.test(text) || /еженедельн|раз в неделю/.test(text);
  const mentions = extractWeekdayTimes(text);
  const found = mentions.map(m => m.weekday);
  const recurring = everyWeekday || every;

  if (!recurring) {
    // «Во вторник и пятницу в 11» — по одной сессии на каждый названный день.
    if (found.length > 1 && !args.date && !args.datetime) {
      applyDays(args, mentions);
      args.repeat_until = undefined;
      args.repeat_count = found.length;
    }
    return;
  }

  applyDays(args, mentions);

  const until = parseUntilFromText(text, timeZone, now);
  if (until) {
    args.repeat_until = until;
    args.repeat_count = undefined;
    return;
  }
  // «До конца месяца» модель считала сама и ошибалась (написала 4 ноября) — это слово психолога главнее.
  if (/до конца (этого )?месяца/.test(text)) {
    args.repeat_until = "end_of_month";
    args.repeat_count = undefined;
    return;
  }
  if (hasRepeat) return;
  const days = Math.max(1, found.length);
  const weeks = text.match(/(?:на|в течение)\s+(\d{1,2})\s+недел/);
  if (weeks) {
    args.repeat_count = Math.min(Number(weeks[1]) * days, MAX_SESSIONS_PER_REQUEST);
    return;
  }
  // «по вторникам» без срока и «на месяц» — на ближайшие 4 недели; психолог видит весь список в карточке и может отказаться.
  args.repeat_count = 4 * days;
}

function applyDays(args: CreateSessionArgs, mentions: Array<{ weekday: string; time: string | null }>): void {
  const found = mentions.map(m => m.weekday);
  if (found.length > 1) args.weekday = found.join(",");
  else if (found.length === 1 && !args.weekday) args.weekday = found[0];
  const times = mentions.map(m => m.time).filter((t): t is string => Boolean(t));
  const distinct = [...new Set(times)];
  if (distinct.length > 1 && mentions.every(m => m.time)) {
    args.schedule = mentions.map(m => ({ weekday: m.weekday, time: m.time as string }));
  } else if (distinct.length === 1) {
    args.time = distinct[0];
    args.schedule = undefined;
  }
}
