// ============================================================
// Анонимизация транскриптов перед отправкой в LLM.
//
// Цель: минимизировать персональные данные третьих лиц (не самого
// клиента — его имя психологу нужно для привязки), которые уходят
// в текстовом виде на серверы YandexGPT при периодических срезах,
// RAG-поиске по истории и генерации контента для соцсетей.
//
// Подход: НЕ переписываем текст целиком через LLM (дорого, медленно,
// модель может исказить клинически важные детали). Вместо этого
// просим yandexgpt-lite найти персональные данные и вернуть JSON со
// списком точечных замен (original → replacement), затем применяем
// эти замены программно через простой replaceAll. Имя клиента
// (clientName) в замены никогда не включается — оно остаётся как
// есть, психологу нужна привязка к конкретному человеку.
//
// Стоимость вызова не списывается из лимита психолога — это
// внутренняя операция платформы, а не запрос, инициированный
// психологом напрямую.
// ============================================================

import { yandexGptCompleteJson, YandexGptError, isModerationRefusal } from "@/lib/yandexgpt";
import { maskProfanity } from "@/lib/profanity";

interface AnonymizeReplacement {
  original: string;
  replacement: string;
}

interface AnonymizeResult {
  replacements: AnonymizeReplacement[];
}

const ANONYMIZE_SYSTEM_PROMPT = `Ты помогаешь анонимизировать транскрипт психологической консультации перед обработкой.

Найди в тексте персональные данные третьих лиц и верни JSON со списком замен:
{"replacements": [{"original": "точная подстрока из текста", "replacement": "чем заменить"}]}

КРИТИЧЕСКИ ВАЖНО про поле "original": замена делается простой текстовой подстановкой без грамматического анализа, поэтому "original" должен быть САМОДОСТАТОЧНЫМ фрагментом, который можно вырезать и вставить "replacement" на его место без задвоений и рассогласования падежей.
- Если рядом с именем уже стоит слово-роль, забирай в "original" ВЕСЬ фрагмент "роль + имя" целиком, а "replacement" делай только роль (без второго упоминания роли):
  правильно: {"original": "мужем Игорем", "replacement": "мужем"} — НЕ {"original": "Игорем", "replacement": "муж"} (иначе получится "мужем муж")
  правильно: {"original": "начальник Петр Сергеевич", "replacement": "начальник"}
- Если организация упомянута с предлогом, забирай предлог в "original" вместе с названием, если "replacement" — это уже готовая фраза с предлогом:
  правильно: {"original": "в Сбербанке", "replacement": "в компании"} — НЕ {"original": "Сбербанке", "replacement": "компании"} (иначе получится "в в компании")
  правильно: {"original": "Сбербанк", "replacement": "компания"}, если рядом нет своего предлога
- Даты замени целиком одним фрагментом: {"original": "15 марта", "replacement": "на прошлой неделе"}, не оставляя рядом дублирующий оборот.
- После применения всех замен получившийся текст должен читаться как естественное предложение — прежде чем добавить замену в список, мысленно подставь replacement на место original и проверь, что не получится повтора слов или лишнего предлога.

Правила выбора replacement:
- Имена третьих лиц (не самого клиента) — замени на роль по контексту: "муж", "жена", "мама", "папа", "сын", "дочь", "коллега", "начальник", "подруга", "друг", "терапевт", "врач" и т.п.
- Названия компаний, мест работы, учебных заведений — замени на общие обозначения: "на работе", "в компании", "в университете".
- Точные даты (числа, месяцы) — замени на относительные: "на прошлой неделе", "несколько месяцев назад", "в начале года". Не трогай относительные обозначения, которые уже в тексте.
- Адреса, названия городов, районов, конкретных географических объектов — замени на общие: "в своём районе", "в поездке", "у себя дома".
- Номера телефонов, email, точные адреса — замени на "[контакт скрыт]".

Не включай в список замен:
- Имя самого клиента (оно указано отдельно и не анонимизируется).
- Общеупотребительные слова, которые не являются персональными данными.
- Диагнозы, симптомы, эмоции, клинически значимые детали — их нельзя терять.

Если персональных данных для замены нет — верни {"replacements": []}.
Верни только JSON, без пояснений.`;

/**
 * Причины, по которым анонимизацию нельзя считать выполненной. Хранится
 * только КОД причины и технические детали (статус ответа, размеры) — никогда
 * текст сессии.
 */
export type AnonymizationFailureReason =
  | "moderation_rejected" // модерация LLM отклонила запрос (400 / отказ в тексте)
  | "llm_error" // сеть/5xx/429 после повторных попыток, не настроен ключ
  | "invalid_response" // ответ не JSON или не соответствует схеме замен
  | "empty_result" // после замен непустой вход превратился в пустой текст
  | "suspicious_result"; // замены удалили подозрительно большую часть текста

/**
 * Анонимизация не удалась — ДАЛЬШЕ ТЕКСТ СЕССИИ НЕ ИДЁТ (fail-closed).
 * Вызывающий код обязан поставить статус manual_review_required и не
 * отправлять сырой текст ни в YandexGPT, ни в БД.
 */
export class AnonymizationError extends Error {
  constructor(
    public reason: AnonymizationFailureReason,
    public technical: string
  ) {
    super(`Анонимизация не выполнена (${reason}): ${technical}`);
    this.name = "AnonymizationError";
  }
}

/** Сообщение психологу при manual_review_required — без технических деталей. */
export const MANUAL_REVIEW_MESSAGE_FOR_PSYCHOLOGIST =
  "Автоматическая обработка этой записи остановлена: не удалось безопасно обезличить текст. " +
  "Аудиозапись сохранена, но расшифровка и черновик протокола не создавались — заполните протокол вручную.";

export interface AnonymizeOptions {
  /** Число повторов при временных сбоях (сеть, 429, 5xx). Модерация не повторяется. */
  maxAttempts?: number;
  /** Базовая пауза между повторами, мс (в тестах 0). */
  retryDelayMs?: number;
}

const SHRINK_GUARD_MIN_CHARS = 80;
const SHRINK_GUARD_RATIO = 0.4;

function isTransient(e: unknown): boolean {
  if (!(e instanceof YandexGptError)) return true; // сетевая/неизвестная ошибка
  if (e.status === undefined) return true;
  return e.status === 429 || e.status >= 500;
}

function validateReplacements(result: unknown): AnonymizeReplacement[] {
  if (!result || typeof result !== "object") {
    throw new AnonymizationError("invalid_response", "ответ модели не объект");
  }
  const replacements = (result as AnonymizeResult).replacements;
  if (!Array.isArray(replacements)) {
    throw new AnonymizationError("invalid_response", "поле replacements отсутствует или не массив");
  }
  for (const item of replacements) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.original !== "string" ||
      (item.replacement !== undefined && item.replacement !== null && typeof item.replacement !== "string")
    ) {
      throw new AnonymizationError("invalid_response", "элемент replacements не соответствует схеме");
    }
  }
  return replacements;
}

function capitalizeFirst(text: string): string {
  return text ? text[0].toLocaleUpperCase("ru-RU") + text.slice(1) : text;
}

function isSentenceStart(textBefore: string): boolean {
  return textBefore.trim() === "" || /(?:[.!?…]|:|\n)\s*$/u.test(textBefore.slice(-6));
}

/**
 * Применяет замены по месту: если замена встаёт в начало предложения, она начинается с заглавной
 * («отец позвонил» → «Отец позвонил»). Имя клиента не трогаем, даже если модель его вернула.
 * После замен схлопываем задвоения вида «на работе на работе», которые возникают, когда модель
 * заменяет название вместе с предлогом, а рядом уже был такой же оборот.
 */
export function applyReplacements(text: string, replacements: AnonymizeReplacement[], clientName: string): string {
  let out = text;
  for (const { original, replacement } of replacements) {
    if (!original) continue;
    if (original.trim() === clientName.trim()) continue;
    const rep = replacement ?? "";
    let result = "";
    let from = 0;
    let idx = out.indexOf(original, from);
    if (idx === -1) continue;
    while (idx !== -1) {
      const before = out.slice(0, idx);
      result += out.slice(from, idx) + (isSentenceStart(before) && /^[A-ZА-ЯЁ0-9]/.test(original) ? capitalizeFirst(rep) : rep);
      from = idx + original.length;
      idx = out.indexOf(original, from);
    }
    out = result + out.slice(from);
  }
  return collapseDuplicates(out, replacements.map(r => r.replacement ?? ""));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Схлопывает задвоения, возникшие из-за замен («на работе на работе» → «на работе»). Трогаем только
 * сами замены: живые повторы в речи клиента («очень-очень», «нет нет») — часть транскрипта.
 */
export function collapseDuplicates(text: string, phrases: string[]): string {
  let out = text;
  const uniq = [...new Set(phrases.map(p => p.trim()).filter(p => p.length >= 2))];
  for (const phrase of uniq) {
    const p = escapeRegExp(phrase).replace(/\s+/g, "\\s+");
    const re = new RegExp(`(?<![\\p{L}])(${p})(?:[ \\t]+${p})+(?![\\p{L}])`, "giu");
    out = out.replace(re, "$1");
  }
  return out.replace(/[ \t]{2,}/g, " ");
}

const SPEAKER_LABEL = /^(?:психолог|клиент|клиентка|терапевт|специалист)$/i;

/** Слова с заглавной буквы не в начале предложения (кандидаты в имена/названия) и их контекст. */
export function findSuspiciousProperNouns(text: string, clientName: string): Array<{ word: string; context: string }> {
  const clientStems = clientName
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/\s+/)
    .filter(w => w.length >= 3)
    .map(w => (w.length > 4 ? w.slice(0, w.length - 2) : w));
  const found: Array<{ word: string; context: string }> = [];
  const seen = new Set<string>();
  const re = /[A-ZА-ЯЁ][a-zа-яё]{2,}/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const word = m[0];
    const before = text.slice(0, m.index);
    if (isSentenceStart(before) || /[«"„]\s*$/.test(before.slice(-2)) && isSentenceStart(before.slice(0, -1))) continue;
    if (SPEAKER_LABEL.test(word)) continue;
    const low = word.toLowerCase().replace(/ё/g, "е");
    if (clientStems.some(st => low.startsWith(st))) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    const start = Math.max(0, m.index - 60);
    const end = Math.min(text.length, m.index + word.length + 60);
    found.push({ word, context: text.slice(start, end).replace(/\s+/g, " ").trim() });
  }
  return found;
}

const DATE_RE = /(?<![\p{L}\d])\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+\d{4})?(?![\p{L}])|(?<![\d.])\d{1,2}\.\d{1,2}\.\d{2,4}(?![\d.])/giu;

/** Заменяет оставшиеся точные даты на «недавно» (в начале предложения — «Недавно»). */
export function scrubDates(text: string): string {
  return text.replace(DATE_RE, (match, offset: number, whole: string) =>
    isSentenceStart(whole.slice(0, offset)) ? "Недавно" : "недавно"
  );
}

/** Точные даты («14 октября», «03.10.2026») — модель иногда оставляет их, хотя промпт требует заменить. */
export function findDateMentions(text: string): Array<{ word: string; context: string }> {
  const found: Array<{ word: string; context: string }> = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(DATE_RE)) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    const idx = m.index ?? 0;
    found.push({
      word: m[0],
      context: text.slice(Math.max(0, idx - 60), Math.min(text.length, idx + m[0].length + 60)).replace(/\s+/g, " ").trim(),
    });
  }
  return found;
}

/**
 * Анонимизирует текст транскрипта перед отправкой в LLM. Имя клиента
 * (clientName) сохраняется как есть — остальные персональные данные
 * третьих лиц заменяются на обобщённые роли/обозначения.
 *
 * Шаги: (1) маскировка ненормативной лексики — ДО первого обращения к
 * YandexGPT (иначе модерация отклоняет сам запрос анонимизации);
 * (2) запрос замен у lite-модели; (3) проверка ответа; (4) применение.
 *
 * FAIL-CLOSED (изменено 04.10.2026): при любом сбое (модерация, сеть
 * после повторов, невалидный/пустой/подозрительный результат) бросает
 * AnonymizationError. Раньше возвращался исходный текст «чтобы не ломать
 * генерацию» — это отправляло неанонимизированную речь клиента в LLM и
 * сохраняло её в БД.
 */
export async function anonymizeTranscript(
  text: string,
  clientName: string,
  options: AnonymizeOptions = {}
): Promise<string> {
  const trimmed = text?.trim();
  if (!trimmed) return text ?? "";

  const masked = maskProfanity(trimmed);
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const retryDelayMs = options.retryDelayMs ?? 600;

  let result: AnonymizeResult | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      result = await yandexGptCompleteJson<AnonymizeResult>(
        [
          {
            role: "system",
            text: `${ANONYMIZE_SYSTEM_PROMPT}\n\nИмя клиента, которое НЕ нужно анонимизировать: "${clientName}".`,
          },
          { role: "user", text: masked },
        ],
        { model: "lite", temperature: 0.1, maxTokens: 1500, throwOnContentFilter: true }
      );
      break;
    } catch (e) {
      if (isModerationRefusal(e)) {
        throw new AnonymizationError("moderation_rejected", "модерация LLM отклонила запрос");
      }
      if (e instanceof YandexGptError && e.message.startsWith("Не удалось разобрать JSON")) {
        // Ответ пришёл, но не JSON — повтор может помочь (temperature>0 не гарантирует), но ограничиваем теми же попытками.
        if (attempt === maxAttempts) throw new AnonymizationError("invalid_response", "ответ модели не JSON");
      } else if (!isTransient(e) || attempt === maxAttempts) {
        const status = e instanceof YandexGptError ? e.status : undefined;
        throw new AnonymizationError("llm_error", `сбой запроса к YandexGPT (status=${status ?? "n/a"}, попыток=${attempt})`);
      }
      if (retryDelayMs > 0) await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
    }
  }

  const replacements = validateReplacements(result);
  let anonymized = applyReplacements(masked, replacements, clientName);

  // Второй, прицельный проход (найдено 17.10 на GigaChat-3-Pro): модель пропускала часть данных
  // («сестра Оксана», «в Бердске»). Слова с заглавной буквы не в начале предложения — почти всегда
  // имена и названия; отдаём модели только их с контекстом и просим заменить то, что является ПДн.
  const suspects = [...findSuspiciousProperNouns(anonymized, clientName), ...findDateMentions(anonymized)];
  if (suspects.length > 0) {
    let second: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        second = await yandexGptCompleteJson<AnonymizeResult>(
          [
            {
              role: "system",
              text:
                `${ANONYMIZE_SYSTEM_PROMPT}\n\nИмя клиента, которое НЕ нужно анонимизировать: "${clientName}".\n\n` +
                `Это повторная проверка. Ниже фрагменты, где остались слова с заглавной буквы. Для каждого слова, которое является ` +
                `именем, фамилией, отчеством третьего лица, названием города, улицы, станции, организации или учебного заведения, ` +
                `верни замену по тем же правилам ("original" — точная подстрока из фрагмента). Остальные слова не включай.`,
            },
            { role: "user", text: suspects.map(x => `- ${x.context}`).join("\n") },
          ],
          { model: "lite", temperature: 0.1, maxTokens: 800, throwOnContentFilter: true }
        );
        break;
      } catch (e) {
        if (isModerationRefusal(e)) throw new AnonymizationError("moderation_rejected", "отказ модерации на повторной проверке");
        if (attempt === maxAttempts || (e instanceof YandexGptError && !isTransient(e) && !e.message.startsWith("Не удалось разобрать JSON"))) {
          throw new AnonymizationError("llm_error", `сбой повторной проверки (попыток=${attempt})`);
        }
        if (retryDelayMs > 0) await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
      }
    }
    anonymized = applyReplacements(anonymized, validateReplacements(second), clientName);
    // Страховка: даты, которые модель так и не заменила, убираем без LLM (она делает это нестабильно).
    anonymized = scrubDates(anonymized);
    const left = findSuspiciousProperNouns(anonymized, clientName).length + findDateMentions(anonymized).length;
    // В лог — только числа, без текста сессии.
    console.log("ANON_SECOND_PASS", JSON.stringify({ suspects: suspects.length, left }));
  }

  if (anonymized.trim() === "") {
    throw new AnonymizationError("empty_result", "после замен текст пуст");
  }
  if (masked.length >= SHRINK_GUARD_MIN_CHARS && anonymized.length < masked.length * SHRINK_GUARD_RATIO) {
    throw new AnonymizationError(
      "suspicious_result",
      `замены сократили текст с ${masked.length} до ${anonymized.length} символов`
    );
  }

  return anonymized;
}

/** Заглушка на месте предложения, которое модерация LLM не пропустила. Сырой текст нигде не сохраняется. */
export const MODERATION_PLACEHOLDER = "[фрагмент скрыт: не прошёл проверку модерации]";

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/u)
    .map(x => x.trim())
    .filter(Boolean);
}

/**
 * Анонимизация одного сегмента, устойчивая к отказу модерации: если сегмент целиком отклонён,
 * обезличиваем его по предложениям, а отклонённое предложение заменяем заглушкой. Остальные
 * ошибки (сеть, невалидный ответ, подозрительный результат) по-прежнему fail-closed.
 */
async function anonymizeSegmentTolerant(
  text: string,
  clientName: string,
  options: AnonymizeOptions
): Promise<{ text: string; moderated: number }> {
  try {
    return { text: await anonymizeTranscript(text, clientName, options), moderated: 0 };
  } catch (e) {
    if (!(e instanceof AnonymizationError) || e.reason !== "moderation_rejected") throw e;
  }
  const sentences = splitSentences(text);
  if (sentences.length <= 1) return { text: MODERATION_PLACEHOLDER, moderated: 1 };
  const parts: string[] = [];
  let moderated = 0;
  for (const sentence of sentences) {
    try {
      parts.push(await anonymizeTranscript(sentence, clientName, options));
    } catch (e) {
      if (e instanceof AnonymizationError && e.reason === "moderation_rejected") {
        parts.push(MODERATION_PLACEHOLDER);
        moderated++;
      } else {
        throw e;
      }
    }
  }
  return { text: parts.join(" "), moderated };
}

/**
 * Анонимизирует сегменты транскрипта (параллельно). Отказ модерации на отдельном сегменте или
 * предложении не роняет всё задание: проблемный кусок заменяется заглушкой, число таких кусков
 * возвращается для пометки «нужна проверка психологом». В лог попадает только число.
 */
export async function anonymizeTranscriptsTolerant(
  texts: string[],
  clientName: string,
  options: AnonymizeOptions = {}
): Promise<{ texts: string[]; moderatedFragments: number }> {
  const results = await Promise.all(texts.map(text => anonymizeSegmentTolerant(text, clientName, options)));
  const moderatedFragments = results.reduce((sum, r) => sum + r.moderated, 0);
  if (moderatedFragments > 0) console.log("ANON_MODERATED", JSON.stringify({ fragments: moderatedFragments, segments: texts.length }));
  return { texts: results.map(r => r.text), moderatedFragments };
}

/**
 * Анонимизирует несколько транскриптов параллельно — удобно для
 * периодических срезов, где обрабатывается сразу несколько сессий.
 */
export async function anonymizeTranscripts(
  texts: string[],
  clientName: string,
  options: AnonymizeOptions = {}
): Promise<string[]> {
  return Promise.all(texts.map(text => anonymizeTranscript(text, clientName, options)));
}
