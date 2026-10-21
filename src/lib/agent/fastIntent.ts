// ------------------------------------------------------------
// Быстрые команды без модели.
//
// Самые частые и однозначные просьбы («создай клиентов Анну и Бориса», «поставь Ивана на завтра в 10»,
// «встречи с Анной по вторникам в 12 и пятницам в 17 до конца ноября») разбираем кодом: это надёжнее и
// дешевле слабой модели, которая путает дни, теряет второго клиента и выдумывает id. Если хоть что-то
// неясно (нет времени, неизвестная дата, несколько клиентов) — возвращаем null, и вопрос уходит модели.
// Результат — то же действие с подтверждением, что вызвала бы модель: психолог видит карточку и жмёт «Да».
// ------------------------------------------------------------

import { addDaysIso, inferRecurrence, type CreateSessionArgs } from "./scheduling";
import { todayInTimeZone, weekdayInTimeZone, zonedDateTimeToUtc } from "@/lib/timezone";
import type { ClientRef } from "./mentionedClients";

export type FastIntent =
  | { tool: "create_client"; args: { names: string[]; then_session?: CreateSessionArgs } }
  | { tool: "create_session"; args: CreateSessionArgs & { client_id: string } };

export interface FastIntentContext {
  /** Клиенты, названные в сообщении (или открытая карточка). Для create_session нужен ровно один. */
  clients: ClientRef[];
  timeZone: string;
  now: Date;
}

const NUMBER_WORDS = "(?:\\d{1,2}|одного|двух|трёх|трех|четырёх|четырех|пять|шесть|семь|восемь|девять|десять)";
const CREATE_CLIENT_VERB = /^(?:пожалуйста[,\s]+)?(?:создай|создать|добавь|добавить|заведи|завести|внеси|внести)\s+/i;

const MONTHS: Array<[RegExp, number]> = [
  [/^январ/, 1], [/^феврал/, 2], [/^март/, 3], [/^апрел/, 4], [/^ма[яй]$/, 5], [/^июн/, 6],
  [/^июл/, 7], [/^август/, 8], [/^сентябр/, 9], [/^октябр/, 10], [/^ноябр/, 11], [/^декабр/, 12],
];
const MONTH_ALT = "январ[яь]|феврал[яь]|марта|апрел[яь]|ма[яй]|июн[яь]|июл[яь]|августа|сентябр[яь]|октябр[яь]|ноябр[яь]|декабр[яь]";

const WEEKDAY_ONCE: Array<[RegExp, number]> = [
  [/(?<![а-яё])понедельник(?![а-яё])/, 1],
  [/(?<![а-яё])вторник(?![а-яё])/, 2],
  [/(?<![а-яё])сред[уы](?![а-яё])/, 3],
  [/(?<![а-яё])четверг(?![а-яё])/, 4],
  [/(?<![а-яё])пятниц[уы](?![а-яё])/, 5],
  [/(?<![а-яё])суббот[уы](?![а-яё])/, 6],
  [/(?<![а-яё])воскресень[ея](?![а-яё])/, 0],
];

function parseCreateClients(message: string): FastIntent | null {
  const text = message.trim().replace(/[.!]+$/, "");
  const m = text.match(CREATE_CLIENT_VERB);
  if (!m) return null;
  let rest = text.slice(m[0].length);
  // Остальные просьбы в том же сообщении («и сразу поставь сессию», «с запросом…») — пусть решает модель.
  if (/(сесси|встреч|запис|заметк|задани|сообщени|напомин|ссылк|рассыл|протокол|шаблон|запрос|подход|лет\b|возраст)/i.test(rest)) return null;
  const hasClientWord = /клиент|пациент/i.test(rest) || /^(?:завед|завест)/i.test(m[0].trim());
  rest = rest
    .replace(new RegExp(`^(?:мне\\s+)?(?:${NUMBER_WORDS}\\s+)?(?:нов\\S*\\s+)?(?:клиент\\S*|пациент\\S*)?\\s*`, "i"), "")
    .replace(/^[:\-—–]\s*/, "")
    .trim();
  if (!rest || !hasClientWord) return null;
  const parts = rest.split(/\s*(?:,|;|\n|\s+и\s+)\s*/).map(s => s.trim().replace(/^[«"']+|[»"']+$/g, "")).filter(Boolean);
  if (parts.length === 0 || parts.length > 30) return null;
  const names: string[] = [];
  for (const p of parts) {
    const words = p.split(/\s+/);
    if (words.length > 3) return null;
    // Каждое слово — имя с заглавной буквы: иначе это не список имён, а обычная фраза.
    if (!words.every(w => /^[А-ЯЁA-Z][а-яёa-z-]{1,}$/.test(w))) return null;
    if (!names.some(n => n.toLowerCase() === p.toLowerCase())) names.push(p);
  }
  return { tool: "create_client", args: { names } };
}

/** Убираем из текста даты (чтобы «25.10» и «25 октября» не принять за время). */
function stripDates(text: string): string {
  return text
    .replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/g, " ")
    .replace(/(?<![\d:.])\d{1,2}\.\d{1,2}(?![\d:.])(?!\s*(?:час|ч\b))/g, (m) => (/^\d{1,2}\.\d{2}$/.test(m) && Number(m.split(".")[0]) <= 23 && Number(m.split(".")[1]) > 12 ? m : " "))
    .replace(new RegExp(`\\d{1,2}\\s+(?:${MONTH_ALT})`, "g"), " ");
}

export function parseTime(text: string): string | null {
  const t = stripDates(text);
  let h: number | null = null;
  let min = 0;
  let end = 0;
  // 15:00, 15.00
  let m = t.match(/(?<![\d:.])(\d{1,2})[:.](\d{2})(?![\d])/);
  if (m) {
    h = Number(m[1]);
    min = Number(m[2]);
  } else {
    // «в 10», «на 10 часов», «к 9 утра»
    m = t.match(/(?:^|\s)(?:в|на|к|около)\s+(\d{1,2})(?:\s*(?:час\S*|ч\b))?(?![\d:.])/);
    if (m) h = Number(m[1]);
  }
  if (!m || h === null || h > 23 || min > 59) return null;
  end = (m.index ?? 0) + m[0].length;
  const tail = t.slice(end, end + 12);
  if (/^\s*вечера/.test(tail) && h < 12) h += 12;
  else if (/^\s*дня/.test(tail) && h < 6) h += 12;
  else if (/^\s*ночи/.test(tail) && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Одна календарная дата из текста: сегодня/завтра/послезавтра, «25 октября», «25.10», «в пятницу». */
export function parseDate(text: string, timeZone: string, now: Date): string | null {
  const today = todayInTimeZone(timeZone, now);
  const [ty, tm, td] = today.split("-").map(Number);
  if (/(?<![а-яё])послезавтра(?![а-яё])/.test(text)) return addDaysIso(today, 2);
  if (/(?<![а-яё])завтра(?![а-яё])/.test(text)) return addDaysIso(today, 1);
  if (/(?<![а-яё])сегодня(?![а-яё])/.test(text)) return today;
  const pad = (n: number) => String(n).padStart(2, "0");
  const dm = text.match(new RegExp(`(\\d{1,2})\\s+(${MONTH_ALT})`));
  if (dm) {
    const month = MONTHS.find(([re]) => re.test(dm[2]))?.[1];
    const day = Number(dm[1]);
    if (!month || day < 1 || day > 31) return null;
    let year = ty;
    if (month < tm || (month === tm && day < td)) year += 1;
    return `${year}-${pad(month)}-${pad(day)}`;
  }
  const dot = text.match(/(?<![\d:.])(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?![\d:])/);
  if (dot) {
    const day = Number(dot[1]);
    const month = Number(dot[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let year = dot[3] ? (dot[3].length === 2 ? 2000 + Number(dot[3]) : Number(dot[3])) : ty;
    if (!dot[3] && (month < tm || (month === tm && day < td))) year += 1;
    return `${year}-${pad(month)}-${pad(day)}`;
  }
  for (const [re, wd] of WEEKDAY_ONCE) {
    if (!re.test(text)) continue;
    const todayWd = weekdayInTimeZone(zonedDateTimeToUtc(today, "12:00", timeZone), timeZone);
    let delta = (wd - todayWd + 7) % 7;
    if (delta === 0) delta = 7;
    return addDaysIso(today, delta);
  }
  return null;
}

const SESSION_VERB = /(?:^|[\s,.])(?:поставь|поставить|создай|создать|запиши|записать|запланируй|запланировать|назначь|назначить|добавь|добавить|организуй)(?![а-яё])/i;
const SESSION_NOUN = /сесси|встреч|приём|прием|консультаци|занят/i;
const PERSONAL = /тренировк|спортзал|фитнес|(?<![а-яё])обед(?![а-яё])|перерыв|отпуск|маникюр|стоматолог|парикмахер/;
const NOT_A_CREATE = /(отмен|перенес|сдвин|удал|измени|покажи|что\s|когда|свободн|окошк|окно|слот|напомни|отправ|напиши|\?)/i;

function parseCreateSession(message: string, ctx: FastIntentContext): FastIntent | null {
  const text = message.toLowerCase().replace(/ё/g, "е");
  if (!SESSION_VERB.test(text) || NOT_A_CREATE.test(text) || PERSONAL.test(text)) return null;
  // Либо названо слово «сессия/встреча», либо просьба в форме «поставь Ивана на завтра в 10».
  if (!SESSION_NOUN.test(text) && !/(?:поставь|запиши|назначь)\s/.test(text)) return null;
  if (ctx.clients.length !== 1) return null;
  const client = ctx.clients[0];
  const time = parseTime(text);

  const args: CreateSessionArgs & { client_id: string } = { client_id: client.id };
  const recurring = /по\s+(?:понедельник|вторник|сред|четверг|пятниц|суббот|воскресень)\S*|кажд(?:ый|ую|ое|ые)\s|еженедельн|раз в неделю/.test(text);
  if (recurring) {
    args.time = time ?? undefined;
    inferRecurrence(message, args, { timeZone: ctx.timeZone, now: ctx.now });
    if (!args.weekday) return null;
    if (!args.time && !args.schedule) return null;
    return { tool: "create_session", args };
  }
  if (!time) return null;
  const date = parseDate(text, ctx.timeZone, ctx.now);
  if (!date) return null;
  args.date = date;
  args.time = time;
  // «Во вторник и пятницу в 11» — по сессии на каждый день: разбор делает inferRecurrence.
  const probe: CreateSessionArgs = { time };
  inferRecurrence(message, probe, { timeZone: ctx.timeZone, now: ctx.now });
  if (probe.weekday && probe.weekday.includes(",") && probe.repeat_count) {
    return { tool: "create_session", args: { client_id: client.id, weekday: probe.weekday, time: probe.time ?? time, repeat_count: probe.repeat_count, schedule: probe.schedule } };
  }
  return { tool: "create_session", args };
}

/** «Создай клиента Олю и сразу поставь ей сессию в пятницу в 11» — одна карточка: клиент, затем его сессия. */
function parseCreateClientAndSession(message: string, ctx: FastIntentContext): FastIntent | null {
  const m = message.match(/^(.+?)[,\s]+(?:и\s+)?(?:сразу\s+)?(?:же\s+)?((?:поставь|запиши|назначь|запланируй)(?![а-яё]).*)$/i);
  if (!m) return null;
  const left = parseCreateClients(m[1]);
  if (!left || left.tool !== "create_client" || left.args.names.length !== 1) return null;
  const right = parseCreateSession(m[2], { ...ctx, clients: [{ id: "__new__", name: left.args.names[0] }] });
  if (!right || right.tool !== "create_session") return null;
  const { client_id: _ignored, ...session } = right.args;
  void _ignored;
  return { tool: "create_client", args: { names: left.args.names, then_session: session } };
}

export function parseFastIntent(message: string, ctx: FastIntentContext): FastIntent | null {
  const text = message.trim();
  if (!text || text.length > 400) return null;
  return parseCreateClientAndSession(text, ctx) ?? parseCreateClients(text) ?? parseCreateSession(text, ctx);
}

const WORD_HOURS = "один|одиннадцать|два|двенадцать|три|четыре|пять|шесть|семь|восемь|девять|десять|час";

/** Есть ли в просьбе время суток: иначе модель подставляет текущее время («14:13»), которого психолог не называл. */
export function messageHasTime(message: string): boolean {
  const t = message.toLowerCase().replace(/ё/g, "е");
  return parseTime(t) !== null || new RegExp(`(?:^|\\s)(?:в|на|к)\\s+(?:${WORD_HOURS})(?![а-я])`).test(t) || /полдень|полночь|через\s+(?:\S+\s+)?час/.test(t);
}

/** Дата, названная в просьбе явно («1 января», «25.10», «в пятницу», «завтра»), либо null. */
export function explicitDate(message: string, timeZone: string, now: Date): string | null {
  return parseDate(message.toLowerCase().replace(/ё/g, "е"), timeZone, now);
}
