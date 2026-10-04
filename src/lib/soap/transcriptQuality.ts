// ============================================================
// Порог качества транскрипта ДО генерации протокола.
//
// Зачем: на почти пустой/шумной записи модель сочиняет правдоподобный
// протокол (реальный случай 03.10: клиент говорил сам с собой, в
// протоколе появилось «домашнее задание — дневник времени», которого
// не обсуждали). Если по записи нечего анализировать, черновик не
// создаётся: психолог видит «Недостаточно данных для черновика
// протокола».
//
// Пороги — константы (подбирались на реальных звонках 02–03.10, будут
// уточняться по бета-тесту). Считаем только «смысловые» слова: без
// меток спикеров, маркера цензуры и слов-паразитов.
// ============================================================

import { PROFANITY_MARKER } from "@/lib/profanity";

export const INSUFFICIENT_DATA_MESSAGE = "Недостаточно данных для черновика протокола";

export const MIN_TOTAL_WORDS = 120;
export const MIN_CLIENT_WORDS = 40;
/** Ниже этой плотности речи (слов/мин, обе дорожки) запись считается почти беззвучной — только если известна длительность ≥ MIN_DURATION_FOR_DENSITY_SEC. */
export const MIN_WORDS_PER_MINUTE = 20;
export const MIN_DURATION_FOR_DENSITY_SEC = 90;
/** Если доля цензурных маркеров среди всех слов выше — текст непригоден. */
export const MAX_CENSORED_SHARE = 0.3;
/** Доля уникальных слов ниже порога — зацикленный/«залипший» ASR. */
export const MIN_UNIQUE_RATIO = 0.25;
export const MIN_NOTES_WORDS = 20;

const FILLERS = new Set(["э", "ээ", "эм", "мм", "м", "ну", "вот", "так", "бы", "ага", "угу", "ой", "ах", "а"]);

const SPEAKER_RE = /^\s*(психолог|клиент)\s*:\s*/i;

export type QualityFailureReason =
  | "empty"
  | "too_short"
  | "client_silent"
  | "low_speech_density"
  | "mostly_censored"
  | "repetitive";

export interface QualityStats {
  totalWords: number;
  clientWords: number | null; // null — разметка спикеров отсутствует
  psychologistWords: number | null;
  censoredMarkers: number;
  uniqueRatio: number;
  wordsPerMinute: number | null;
}

export type QualityVerdict =
  | { ok: true; stats: QualityStats }
  | { ok: false; reason: QualityFailureReason; stats: QualityStats };

export function countMeaningfulWords(text: string): number {
  return tokenize(text).length;
}

function tokenize(text: string): string[] {
  const withoutMarker = text.split(PROFANITY_MARKER).join(" ");
  const tokens = withoutMarker.toLowerCase().match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? [];
  return tokens.filter(t => !t.split(/[-']/).every(part => FILLERS.has(part)) && (t.length >= 2 || /\p{N}/u.test(t)));
}

export function assessTranscriptQuality(
  rawText: string | null | undefined,
  durationSeconds?: number | null
): QualityVerdict {
  const text = (rawText ?? "").trim();
  const censoredMarkers = text ? text.split(PROFANITY_MARKER).length - 1 : 0;

  let clientWords: number | null = null;
  let psychologistWords: number | null = null;
  const allTokens: string[] = [];
  let sawLabels = false;

  if (text) {
    clientWords = 0;
    psychologistWords = 0;
    for (const line of text.split(/\n+/)) {
      const match = SPEAKER_RE.exec(line);
      const body = match ? line.slice(match[0].length) : line;
      const tokens = tokenize(body);
      allTokens.push(...tokens);
      if (match) {
        sawLabels = true;
        if (match[1].toLowerCase() === "клиент") clientWords += tokens.length;
        else psychologistWords += tokens.length;
      }
    }
    if (!sawLabels) {
      clientWords = null;
      psychologistWords = null;
    }
  }

  const totalWords = allTokens.length;
  const uniqueRatio = totalWords > 0 ? new Set(allTokens).size / totalWords : 0;
  const wordsPerMinute =
    durationSeconds && durationSeconds >= MIN_DURATION_FOR_DENSITY_SEC ? totalWords / (durationSeconds / 60) : null;
  const stats: QualityStats = { totalWords, clientWords, psychologistWords, censoredMarkers, uniqueRatio, wordsPerMinute };

  const fail = (reason: QualityFailureReason): QualityVerdict => ({ ok: false, reason, stats });

  if (totalWords === 0) return fail("empty");
  if (totalWords < MIN_TOTAL_WORDS) return fail("too_short");
  if (clientWords !== null && clientWords < MIN_CLIENT_WORDS) return fail("client_silent");
  if (wordsPerMinute !== null && wordsPerMinute < MIN_WORDS_PER_MINUTE) return fail("low_speech_density");
  if (censoredMarkers / (totalWords + censoredMarkers) > MAX_CENSORED_SHARE) return fail("mostly_censored");
  if (uniqueRatio < MIN_UNIQUE_RATIO) return fail("repetitive");
  return { ok: true, stats };
}
