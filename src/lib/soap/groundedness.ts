// ============================================================
// Пост-валидация черновика протокола: «только то, что есть в записи».
//
// Промпт запрещает выдумывать (см. lib/prompts/soap.ts), но модель
// всё равно иногда добавляет домашние задания, диагнозы, рекомендации
// и «цитаты». Эта проверка — вторая линия защиты, детерминированная,
// без обращения к LLM: если раздел содержит такой материал, которого
// нет во входных данных (транскрипт, заметки психолога, резюме прошлых
// сессий), раздел заменяется на «Недостаточно данных…», а факт замены
// возвращается в issues (без текста сессии — только блок и тип).
//
// Проверка намеренно консервативна в сторону безопасности: лучше
// потерять часть черновика, чем выдать психологу выдуманный факт.
// ============================================================

import type { SoapResult } from "@/lib/prompts/soap";

export const NO_DATA_FIELD_TEXT = "Недостаточно данных: в записи сессии нет оснований для этого раздела.";

export type SoapBlockKey = "s" | "o" | "a" | "p";

export type GuardIssueKind =
  | "unsupported_homework"
  | "unsupported_diagnosis"
  | "unsupported_recommendation"
  | "unsupported_number"
  | "unsupported_quote"
  | "low_overlap"
  | "invalid_field";

export interface GuardIssue {
  block: SoapBlockKey;
  kind: GuardIssueKind;
}

function norm(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}

// Материал, который модель любит добавлять «от себя». Совпадение в разделе допустимо,
// только если ТА ЖЕ основа встречается во входных данных.
const RISKY_PATTERNS: { kind: GuardIssueKind; re: RegExp }[] = [
  { kind: "unsupported_homework", re: /домашн\p{L}*\s+задани|(?<![\p{L}])дз(?![\p{L}])|упражнени|дневник|медитац|дыхательн|релаксац|самонаблюден|техник[аиуео](?![\p{L}])/u },
  { kind: "unsupported_diagnosis", re: /диагноз|расстройств|депресси|птср|посттравматич|шизофрен|биполярн|невроз|психоз|синдром|выгорани|\bf\d{2}\b/u },
  { kind: "unsupported_recommendation", re: /рекоменд|назначить|необходимо пройти|стоит пройти|направить к|психиатр|медикамент|препарат/u },
];

// Служебные слова, которые не считаем «содержательными» при оценке пересечения с источником.
const STOP_STEMS = new Set([
  "клиен", "психо", "сесси", "можно", "предп", "необх", "более", "детал", "возмо", "стоит", "также", "котор",
  "связа", "рамка", "данны", "обсуж", "работ", "ходе", "время", "подроб", "заяви", "говор", "отмеч", "сообщ", "выраж",
  "наблю", "общей", "сказа", "поэто", "когда", "очень", "чтобы", "перед", "после", "между", "нужно", "будет", "именн", "недос", "данны",
]);

function contentStems(text: string): string[] {
  const words = norm(text).match(/\p{L}{5,}/gu) ?? [];
  return words.map(w => w.slice(0, 5)).filter(stem => !STOP_STEMS.has(stem));
}

export const MIN_OVERLAP = 0.5;
const MIN_WORDS_FOR_OVERLAP = 6;

function extractQuotes(text: string): string[] {
  const quotes: string[] = [];
  const re = /«([^»]{8,})»|"([^"]{8,})"|“([^”]{8,})”/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    quotes.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return quotes;
}

function wordsOf(text: string): string[] {
  return norm(text).match(/\p{L}+/gu) ?? [];
}

/** Цитата считается подтверждённой, если все её слова встречаются во входных данных подряд (с точностью до пунктуации). */
function quoteSupported(quote: string, normalizedSource: string): boolean {
  const q = wordsOf(quote);
  if (q.length < 3) return true; // 1–2 слова не проверяем
  const flatSource = wordsOf(normalizedSource).join(" ");
  return flatSource.includes(q.join(" "));
}

function numbersOf(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)?/g) ?? [];
}

// Модель часто пишет «три» цифрой «3» — это не выдумка. Для чисел 1–10 принимаем и словесную форму во входе.
const NUMBER_WORDS: Record<string, RegExp> = {
  "1": /один|одна|одно|одну|перв/u, "2": /два|две|двух|втор/u, "3": /три|трех|трет/u, "4": /четыр|четвер/u,
  "5": /пят/u, "6": /шест/u, "7": /сем|седьм/u, "8": /восем|восьм/u, "9": /девя/u, "10": /десят/u,
};

function numberSupported(n: string, source: string, sourceNumbers: Set<string>): boolean {
  if (sourceNumbers.has(n)) return true;
  const word = NUMBER_WORDS[n];
  return Boolean(word && word.test(source));
}

export function guardSoapDraft(draft: SoapResult, sourceText: string): { result: SoapResult; issues: GuardIssue[] } {
  const source = norm(sourceText);
  const sourceStems = new Set(contentStems(sourceText));
  const sourceNumbers = new Set(numbersOf(source));
  const issues: GuardIssue[] = [];
  const result: SoapResult = { s: "", o: "", a: "", p: "" };

  (["s", "o", "a", "p"] as const).forEach(block => {
    const value = (draft as unknown as Record<string, unknown>)[block];
    if (typeof value !== "string") {
      issues.push({ block, kind: "invalid_field" });
      result[block] = NO_DATA_FIELD_TEXT;
      return;
    }
    const text = value.trim();
    if (!text || /^недостаточно данных/i.test(text)) {
      result[block] = text || NO_DATA_FIELD_TEXT;
      return;
    }

    const normalized = norm(text);
    const blockIssues: GuardIssueKind[] = [];

    for (const { kind, re } of RISKY_PATTERNS) {
      const match = re.exec(normalized);
      if (match && !re.test(source)) blockIssues.push(kind);
    }
    if (numbersOf(normalized).some(n => !numberSupported(n, source, sourceNumbers))) blockIssues.push("unsupported_number");
    if (extractQuotes(text).some(q => !quoteSupported(q, source))) blockIssues.push("unsupported_quote");

    const stems = contentStems(text);
    if (stems.length >= MIN_WORDS_FOR_OVERLAP) {
      const supported = stems.filter(stem => sourceStems.has(stem)).length;
      if (supported / stems.length < MIN_OVERLAP) blockIssues.push("low_overlap");
    }

    if (blockIssues.length > 0) {
      for (const kind of new Set(blockIssues)) issues.push({ block, kind });
      result[block] = NO_DATA_FIELD_TEXT;
    } else {
      result[block] = text;
    }
  });

  return { result, issues };
}

/** Разбор ответа модели в SoapResult с проверкой типов. Бросает Error при некорректной структуре. */
export function parseSoapJson(rawText: string): SoapResult {
  const cleaned = rawText
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("not an object");
  const obj = parsed as Record<string, unknown>;
  return { s: obj.s as string, o: obj.o as string, a: obj.a as string, p: obj.p as string };
}
