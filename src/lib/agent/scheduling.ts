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

  if (!time) throw new Error("Не указано время сессии (формат ЧЧ:ММ, местное время психолога).");

  const weekday = parseWeekday(args.weekday);
  if (!date) {
    if (weekday === null) throw new Error("Не указана дата сессии (date) или день недели (weekday).");
    date = today;
  }
  // Если задан день недели — сдвигаем дату вперёд до ближайшего такого дня (включая саму дату).
  if (weekday !== null) {
    for (let i = 0; i < 7; i++) {
      const probe = addDays(date, i);
      if (weekdayInTimeZone(zonedDateTimeToUtc(probe, "12:00", timeZone), timeZone) === weekday) {
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

  const dates: string[] = [date];
  if (until || count) {
    for (let i = 1; i < MAX_SESSIONS_PER_REQUEST; i++) {
      const next = addDays(date, 7 * i);
      if (count && dates.length >= count) break;
      if (until && next > until) break;
      if (!until && !count) break;
      dates.push(next);
    }
  }

  const starts = dates.map(d => zonedDateTimeToUtc(d, time as string, timeZone));
  // Прошедшие даты не создаём (например, «весь месяц», когда месяц уже идёт) — но разовую сессию в прошлом молча не режем.
  const upcoming = dates.length > 1 ? starts.filter(s => s.getTime() > now.getTime()) : starts;
  if (upcoming.length === 0) throw new Error("Все указанные даты уже в прошлом.");
  if (upcoming.length === 1 && dates.length === 1 && upcoming[0].getTime() <= now.getTime()) {
    throw new Error("Это время уже прошло.");
  }
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
