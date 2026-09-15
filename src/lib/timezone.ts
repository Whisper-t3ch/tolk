// ------------------------------------------------------------
// Работа с часовыми поясами без внешних зависимостей (Intl API).
//
// Зачем: scheduled_at хранится в UTC (timestamptz), а психолог думает
// и настраивает рабочие часы в своём местном времени. До появления
// этого модуля бронирование считало «15:00» как 15:00 UTC, из-за чего
// сессия, выбранная клиентом на 15:00, попадала в кабинет психолога
// на 21:00 (проверено в GMT+6).
//
// Преобразование делается только на границах: при создании брони
// (местное -> UTC) и при отображении (UTC -> местное).
// ------------------------------------------------------------

/** Часовой пояс по умолчанию — им пользуется большинство психологов сервиса. */
export const DEFAULT_TIMEZONE = "Europe/Moscow";

/** Пояса России + СНГ для выбора в настройках. */
export const TIMEZONE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "Europe/Kaliningrad", label: "Калининград (МСК−1)" },
  { value: "Europe/Moscow", label: "Москва, Санкт-Петербург (МСК)" },
  { value: "Europe/Samara", label: "Самара, Ижевск (МСК+1)" },
  { value: "Asia/Yekaterinburg", label: "Екатеринбург, Пермь, Уфа (МСК+2)" },
  { value: "Asia/Omsk", label: "Омск (МСК+3)" },
  { value: "Asia/Krasnoyarsk", label: "Красноярск, Новокузнецк (МСК+4)" },
  { value: "Asia/Irkutsk", label: "Иркутск, Улан-Удэ (МСК+5)" },
  { value: "Asia/Yakutsk", label: "Якутск, Чита (МСК+6)" },
  { value: "Asia/Vladivostok", label: "Владивосток, Хабаровск (МСК+7)" },
  { value: "Asia/Magadan", label: "Магадан, Южно-Сахалинск (МСК+8)" },
  { value: "Asia/Kamchatka", label: "Петропавловск-Камчатский (МСК+9)" },
  { value: "Asia/Almaty", label: "Алматы, Астана" },
  { value: "Asia/Tashkent", label: "Ташкент" },
  { value: "Asia/Tbilisi", label: "Тбилиси" },
  { value: "Asia/Yerevan", label: "Ереван" },
  { value: "Europe/Minsk", label: "Минск" },
];

export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? (tz as string) : DEFAULT_TIMEZONE;
}

/**
 * Смещение часового пояса (в миллисекундах) для конкретного момента.
 * Считается через Intl, поэтому автоматически учитывает переходы на
 * летнее время там, где они есть.
 */
function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  // Intl отдаёт 24 для полуночи в некоторых движках — приводим к 0.
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
  return asUtc - date.getTime();
}

/**
 * «2026-09-11» + «15:00» в зоне psychologist'а -> момент времени (UTC).
 *
 * Двойной проход нужен для корректной работы на границе перехода
 * летнего времени: первое приближение может дать смещение соседнего
 * периода, второе — уточняет его.
 */
export function zonedDateTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const tz = normalizeTimeZone(timeZone);
  const naiveUtcMs = Date.parse(`${dateStr}T${timeStr}:00Z`);
  if (Number.isNaN(naiveUtcMs)) {
    throw new Error(`Некорректные дата/время: ${dateStr} ${timeStr}`);
  }
  let offset = timeZoneOffsetMs(new Date(naiveUtcMs), tz);
  let utcMs = naiveUtcMs - offset;
  offset = timeZoneOffsetMs(new Date(utcMs), tz);
  utcMs = naiveUtcMs - offset;
  return new Date(utcMs);
}

/** Момент времени -> «YYYY-MM-DD» в нужной зоне. */
export function formatDateInTimeZone(date: Date, timeZone: string): string {
  const tz = normalizeTimeZone(timeZone);
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(date); // en-CA даёт формат YYYY-MM-DD
}

/** Момент времени -> «HH:MM» в нужной зоне. */
export function formatTimeInTimeZone(date: Date, timeZone: string): string {
  const tz = normalizeTimeZone(timeZone);
  const dtf = new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  return dtf.format(date);
}

/** Текущее «сегодня» (YYYY-MM-DD) в зоне психолога, а не сервера. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  return formatDateInTimeZone(now, timeZone);
}

/**
 * Прошла ли уже сессия, назначенная на `date` (YYYY-MM-DD) и `time`
 * (HH:MM) в зоне психолога.
 *
 * Раньше сессии делились на предстоящие и прошедшие по одной лишь дате,
 * поэтому встреча, которую психолог провёл сорок минут назад и по
 * которой уже сгенерировал протокол, до самой полуночи оставалась в
 * «Предстоящих» с кнопкой «Начать». Сравниваем момент окончания: пока
 * сессия идёт, она остаётся предстоящей — к ней ещё можно
 * присоединиться.
 */
export function isSessionPast(
  date: string,
  time: string,
  timeZone: string,
  durationMinutes = 50,
  now: Date = new Date()
): boolean {
  const endsAt = zonedDateTimeToUtc(date, time, timeZone).getTime() + durationMinutes * 60_000;
  return endsAt <= now.getTime();
}

/** День недели (0 = воскресенье) в нужной зоне — для рабочих часов. */
export function weekdayInTimeZone(date: Date, timeZone: string): number {
  const tz = normalizeTimeZone(timeZone);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date);
  const order = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const idx = order.indexOf(name);
  return idx === -1 ? new Date(date).getUTCDay() : idx;
}
