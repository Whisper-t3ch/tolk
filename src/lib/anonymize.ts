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
  | "moderation_rejected" // YandexGPT отклонил запрос модерацией (400)
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
        throw new AnonymizationError("moderation_rejected", "YandexGPT отклонил запрос модерацией");
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

  let anonymized = masked;
  for (const { original, replacement } of replacements) {
    if (!original) continue;
    // Защита от случайного затирания имени клиента, если модель всё же
    // включила его в список замен вопреки инструкции.
    if (original.trim() === clientName.trim()) continue;
    anonymized = anonymized.split(original).join(replacement ?? "");
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
