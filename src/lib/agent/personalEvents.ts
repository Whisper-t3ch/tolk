// ------------------------------------------------------------
// Личные (бытовые) события в календаре психолога: тренировка, обед, врач…
// Это не сессии с клиентами. Ассистент создаёт их тем же способом, что и сессии:
// модель/быстрый разбор называют смысл, а даты и время считает сервер в поясе психолога.
// ------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDateInTimeZone, zonedDateTimeToUtc } from "@/lib/timezone";
import { addDaysIso, type CreateSessionArgs } from "./scheduling";

export interface CreatePersonalEventArgs extends CreateSessionArgs {
  /** Название события: «Тренировка», «Обед», «Врач». */
  title?: string;
}

export const DEFAULT_PERSONAL_EVENT_MINUTES = 60;

/** Слово в просьбе → название события в именительном падеже. Порядок важен: первое совпадение побеждает. */
const TITLE_WORDS: Array<[RegExp, string]> = [
  [/тренировк/, "Тренировка"],
  [/спортзал/, "Спортзал"],
  [/(?<![а-яё])зал(?:[ауе]|ом)?(?![а-яё])/, "Зал"],
  [/фитнес/, "Фитнес"],
  [/(?<![а-яё])йог[аиу]?(?![а-яё])/, "Йога"],
  [/пробежк/, "Пробежка"],
  [/бассейн/, "Бассейн"],
  [/массаж/, "Массаж"],
  [/маникюр/, "Маникюр"],
  [/парикмахер/, "Парикмахер"],
  [/стоматолог/, "Стоматолог"],
  [/(?<![а-яё])врач(?:[ауе]|ом)?(?![а-яё])/, "Врач"],
  [/(?<![а-яё])обед(?![а-яё])/, "Обед"],
  [/(?<![а-яё])ужин(?![а-яё])/, "Ужин"],
  [/(?<![а-яё])завтрак(?![а-яё])/, "Завтрак"],
  [/перерыв/, "Перерыв"],
  [/отпуск/, "Отпуск"],
  [/выходн/, "Выходной"],
  [/супервизи/, "Супервизия"],
  [/личн\S*\s+терапи/, "Личная терапия"],
];

/** Просьба про личное событие, а не про сессию с клиентом. */
export const PERSONAL_EVENT_RE = new RegExp(
  TITLE_WORDS.map(([re]) => re.source).join("|") + "|личн\\S*\\s+(?:дел|событ|встреч|время)|бытов\\S*\\s+(?:дел|событ)",
  "i"
);

/** Название события из текста просьбы: сначала текст в кавычках, затем знакомые слова. null — не удалось понять. */
export function extractPersonalTitle(message: string): string | null {
  const quoted = message.match(/[«"“]([^»"”]{2,80})[»"”]/);
  if (quoted) {
    const t = quoted[1].trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  const text = message.toLowerCase().replace(/ё/g, "е");
  for (const [re, title] of TITLE_WORDS) if (re.test(text)) return title;
  return null;
}

/** Заголовок, пригодный для хранения: без переводов строк, не длиннее 200 символов. */
export function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim().slice(0, 200);
  return t.length > 0 ? t : null;
}

/** «Заполни расписание тренировками во вторник и пятницу на месяц» — это серия, хотя слов «по вторникам» нет. */
export function wantsSeries(message: string): boolean {
  const t = message.toLowerCase().replace(/с\s+\d{1,2}(?::\d{2})?\s+до\s+\d{1,2}(?::\d{2})?/g, " ");
  return /на\s+(?:месяц|неделю|\d{1,2}\s+недел)|до\s+конца|до\s+\d{1,2}(?:[.\s]|$)|заполни/.test(t);
}

/** Длительность из просьбы: «на 2 часа», «на 90 минут», «на полтора часа», «с 18 до 19:30». null — не названа. */
export function parseDurationMinutes(message: string): number | null {
  const t = message.toLowerCase().replace(/ё/g, "е");
  const range = rangeOf(t);
  if (range) return range.minutes;
  let m = t.match(/на\s+(\d{1,3})\s*(?:мин|м\b)/);
  if (m) return Number(m[1]);
  if (/на\s+полтора\s+час/.test(t)) return 90;
  if (/на\s+(?:пол\s*часа|полчаса)/.test(t)) return 30;
  m = t.match(/на\s+(\d{1,2})(?:[.,](\d))?\s*час/);
  if (m) return Math.round((Number(m[1]) + (m[2] ? Number(m[2]) / 10 : 0)) * 60);
  m = t.match(/на\s+(час|два|три|четыре)\s*(?:час|часа|часов)?/);
  if (m) return ({ "час": 60, "два": 120, "три": 180, "четыре": 240 } as Record<string, number>)[m[1]] ?? null;
  return null;
}

const MONTH_AFTER = "(?!\\s*(?:январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр))";

/** «с 18 до 19:30» → начало и длительность. Даты вроде «с 5 до 7 ноября» не трогаем. */
export function rangeOf(t: string): { start: string; minutes: number } | null {
  const re = new RegExp(`(?:^|[\\s,])с\\s+(\\d{1,2})(?::(\\d{2}))?\\s+до\\s+(\\d{1,2})(?::(\\d{2}))?(?!\\d|[.:]\\d)${MONTH_AFTER}`);
  const m = t.match(re);
  if (!m) return null;
  const h1 = Number(m[1]), m1 = Number(m[2] ?? 0), h2 = Number(m[3]), m2 = Number(m[4] ?? 0);
  if (h1 > 23 || h2 > 24 || m1 > 59 || m2 > 59) return null;
  const minutes = h2 * 60 + m2 - (h1 * 60 + m1);
  if (minutes < 5 || minutes > 1440) return null;
  return { start: `${String(h1).padStart(2, "0")}:${String(m1).padStart(2, "0")}`, minutes };
}

export interface PersonalBusy {
  start: number;
  end: number;
  title: string;
  date: string;
  time: string;
}

/**
 * Личные события, пересекающие окно [fromMs, toMs] (мс UTC). Если таблицы ещё нет (миграция 051 не применена)
 * или запрос не удался — пустой список: сессии и слоты должны работать и без личных событий.
 */
export async function loadPersonalBusy(
  supabase: SupabaseClient,
  psychologistId: string,
  timeZone: string,
  fromMs: number,
  toMs: number
): Promise<PersonalBusy[]> {
  try {
    const dateFrom = addDaysIso(formatDateInTimeZone(new Date(fromMs), timeZone), -1);
    const dateTo = addDaysIso(formatDateInTimeZone(new Date(toMs), timeZone), 1);
    const { data, error } = await supabase
      .from("personal_events")
      .select("event_date, start_time, duration_minutes, title")
      .eq("psychologist_id", psychologistId)
      .gte("event_date", dateFrom)
      .lte("event_date", dateTo)
      .limit(2000);
    if (error || !data) return [];
    return data
      .map(r => {
        const date = r.event_date as string;
        const time = String(r.start_time).slice(0, 5);
        const start = zonedDateTimeToUtc(date, time, timeZone).getTime();
        return { start, end: start + ((r.duration_minutes as number | null) ?? DEFAULT_PERSONAL_EVENT_MINUTES) * 60_000, title: String(r.title), date, time };
      })
      .filter(b => b.start < toMs && b.end > fromMs);
  } catch {
    return [];
  }
}
