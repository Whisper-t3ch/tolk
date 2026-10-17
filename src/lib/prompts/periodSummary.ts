// ============================================================
// Промпт и общая логика построения периодического среза по клиенту
// (period_summaries). Списывает 1 запрос из лимита ассистента
// (см. src/lib/assistantLimits.ts, ASSISTANT_REQUEST_COST.heavy).
//
// buildPeriodSummary() — единая точка входа, используется и из
// /api/clients/[id]/summary (явный список session_ids), и из
// lib/agent/executor.ts (get_period_summary tool, диапазон дат). Раньше
// это были две независимые копии одной и той же логики сборки
// контекста + вызова LLM, которые разошлись по поведению (агентская
// версия не списывала лимит и не сохраняла результат в БД) — теперь
// общий код живёт в одном месте, а решение о сохранении/списании лимита
// осознанно остаётся на вызывающей стороне (это разная политика между
// HTTP route и agent tool, её не стоит прятать внутри shared-функции).
//
// Транскрипты (session_transcripts.raw_text) анонимизируются один раз
// при сохранении, в /api/webhooks/recording — здесь они читаются уже
// готовыми, повторная анонимизация не нужна (раньше была здесь и
// применялась точечно перед каждым LLM-запросом; убрана вместе с
// переходом на анонимизацию "на входе").
//
// Найдено при прогоне: если у сессии нет транскрипта (звонок не
// записывался или запись не удалась), сессия просто выпадала из среза
// целиком — даже если психолог добросовестно заполнил протокол
// (soap_notes) вручную. Психолог видел "срез недоступен" при явно
// достаточных для этого данных. Теперь для таких сессий в качестве
// материала для LLM используется протокол (все четыре блока s/o/a/p) —
// он менее подробен, чем полный транскрипт, но содержательно
// эквивалентен заметкам, из которых строится и сам протокол.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { yandexGptCompleteJson, YandexGptError } from "@/lib/yandexgpt";
import { checkResponseSafety } from "@/lib/agent/responseGuard";

export const PERIOD_SUMMARY_SYSTEM_PROMPT = `Ты клинический ассистент психолога.
На основе транскриптов нескольких сессий с одним клиентом составь обобщённое резюме на русском языке.
Выдели: ключевые темы работы, динамику состояния клиента, прогресс, повторяющиеся паттерны, незакрытые вопросы.
Опирайся только на то, что прозвучало в сессиях. Не ставь диагнозов и клинических ярлыков (выгорание, депрессия, расстройство и т. п.), если их не называл сам психолог в сессиях, — описывай состояние словами из записей.
Ответь в формате JSON:
{"key_themes": "string", "dynamics": "string", "progress": "string", "patterns": "string", "open_questions": "string"}
Ключи — ровно эти пять, на английском, на верхнем уровне объекта. Значение каждого — непустая строка (не список и не объект). Без markdown и без текста вне JSON.`;

export const PERIOD_SUMMARY_BUDGET_CHARS = 60000;

export interface PeriodSummaryInput {
  sessionsCount: number;
  dateStart: string;
  dateEnd: string;
  /** Транскрипты сессий, уже отформатированные с разделителями между сессиями. */
  transcripts: string;
}

export function buildPeriodSummaryUserMessage(input: PeriodSummaryInput): string {
  return `Транскрипты ${input.sessionsCount} сессий с ${input.dateStart} по ${input.dateEnd}:\n${input.transcripts}`;
}

export interface PeriodSummaryResult {
  key_themes: string;
  dynamics: string;
  progress: string;
  patterns: string;
  open_questions: string;
}

/** Собирает читаемый текст из структурированного результата — для сохранения в period_summaries.summary и для .txt-скачивания. */
export function formatPeriodSummaryAsText(result: PeriodSummaryResult): string {
  return [
    `Ключевые темы:\n${result.key_themes}`,
    `Динамика состояния:\n${result.dynamics}`,
    `Прогресс:\n${result.progress}`,
    `Повторяющиеся паттерны:\n${result.patterns}`,
    `Незакрытые вопросы:\n${result.open_questions}`,
  ].join("\n\n");
}

// Найдено 20.09 при тесте retry для responseGuard (см. ниже): модель
// иногда не заполняет одно из пяти полей JSON (чаще всего dynamics) —
// yandexGptCompleteJson не бросает ошибку в этом случае (JSON валиден,
// просто ключ отсутствует или null), и formatPeriodSummaryAsText
// подставляет буквальное "undefined" в текст, который видит психолог
// ("Динамика состояния:\nundefined"). Это хуже, чем responseGuard-
// fallback: выглядит как сломанный продукт, а не как честное сообщение
// об ошибке. Проверяем все 5 полей на непустую строку — при провале
// используем тот же retry-путь, что и для responseGuard, а не отдельный
// механизм.
const PERIOD_SUMMARY_KEYS = ["key_themes", "dynamics", "progress", "patterns", "open_questions"] as const;
const PERIOD_SUMMARY_ALIASES: Record<(typeof PERIOD_SUMMARY_KEYS)[number], RegExp> = {
  key_themes: /^(key_?themes|themes|keythemes|ключев|темы)/i,
  dynamics: /^(dynamic|динамик)/i,
  progress: /^(progress|прогресс)/i,
  patterns: /^(pattern|recurring|повтор|паттерн)/i,
  open_questions: /^(open_?questions|unresolved|открыт|незакрыт)/i,
};

function valueToText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.map(valueToText).filter(Boolean).map(x => `— ${x}`).join("\n");
  if (v && typeof v === "object") return Object.values(v as Record<string, unknown>).map(valueToText).filter(Boolean).join("\n");
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/**
 * GigaChat отвечает JSON-ом не всегда в заданной форме: оборачивает в {"summary": {...}}, пишет
 * русские ключи или списки вместо строк. Без нормализации психолог видел «Ключевые темы: undefined».
 */
export function normalizePeriodSummary(raw: unknown): PeriodSummaryResult {
  let obj: Record<string, unknown> = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const keys = Object.keys(obj);
  if (keys.length === 1 && obj[keys[0]] && typeof obj[keys[0]] === "object" && !Array.isArray(obj[keys[0]])) {
    obj = obj[keys[0]] as Record<string, unknown>;
  }
  const out = {} as PeriodSummaryResult;
  for (const k of PERIOD_SUMMARY_KEYS) {
    const direct = obj[k];
    const aliasKey = direct === undefined ? Object.keys(obj).find(ok => PERIOD_SUMMARY_ALIASES[k].test(ok.replace(/\s+/g, "_"))) : undefined;
    out[k] = valueToText(direct !== undefined ? direct : aliasKey ? obj[aliasKey] : undefined);
  }
  return out;
}

function hasAllPeriodSummaryFields(result: PeriodSummaryResult): boolean {
  return (["key_themes", "dynamics", "progress", "patterns", "open_questions"] as const).every(
    key => typeof result[key] === "string" && result[key].trim().length > 0
  );
}

export interface PeriodSummarySession {
  id: string;
  scheduled_at: string;
}

export class PeriodSummaryError extends Error {}

export interface PeriodSummaryOutput {
  summaryText: string;
  structured: PeriodSummaryResult;
  sectionsCount: number;
  dateStart: string;
  dateEnd: string;
}

/**
 * Строит периодический срез по уже отобранному списку сессий клиента.
 * Вызывающий код отвечает за то, ЧТО попадает в `sessions` (явный
 * session_ids[] в route, диапазон дат в agent tool) — здесь только общая
 * часть: подтянуть уже анонимизированные транскрипты, вызвать LLM.
 * Бросает PeriodSummaryError с понятным сообщением на русском при
 * отсутствии транскриптов — вызывающий код сам решает, как это подать
 * (HTTP 404 vs AgentToolError).
 */
export async function buildPeriodSummary(
  supabase: SupabaseClient,
  sessions: PeriodSummarySession[],
  clientName: string
): Promise<PeriodSummaryOutput> {
  if (sessions.length === 0) {
    throw new PeriodSummaryError("Нет сессий для построения среза");
  }

  const sessionIds = sessions.map(s => s.id);
  const { data: transcripts, error: transcriptsError } = await supabase
    .from("session_transcripts")
    .select("session_id, raw_text, created_at")
    .in("session_id", sessionIds)
    .order("created_at", { ascending: false });
  if (transcriptsError) {
    throw new PeriodSummaryError(transcriptsError.message);
  }

  const latestBySession = new Map<string, string>();
  for (const t of transcripts ?? []) {
    const sid = t.session_id as string;
    if (!latestBySession.has(sid) && t.raw_text) {
      latestBySession.set(sid, t.raw_text as string);
    }
  }

  // Fallback для сессий без транскрипта: берём протокол (soap_notes),
  // если он заполнен. Менее подробно, чем полный транскрипт, но
  // достаточно, чтобы не выбрасывать такую сессию из среза целиком.
  const missingTranscriptIds = sessionIds.filter(id => !latestBySession.has(id));
  const protocolBySession = new Map<string, string>();
  if (missingTranscriptIds.length > 0) {
    const { data: soapNotes, error: soapError } = await supabase
      .from("soap_notes")
      .select("session_id, s_subjective, o_objective, a_assessment, p_plan")
      .in("session_id", missingTranscriptIds);
    if (soapError) {
      throw new PeriodSummaryError(soapError.message);
    }
    for (const note of soapNotes ?? []) {
      const parts = [
        note.s_subjective ? `Жалоба и запрос клиента: ${note.s_subjective}` : null,
        note.o_objective ? `Контекст и наблюдения: ${note.o_objective}` : null,
        note.a_assessment ? `Гипотеза психолога: ${note.a_assessment}` : null,
        note.p_plan ? `Договорённости и план: ${note.p_plan}` : null,
      ].filter(Boolean);
      if (parts.length > 0) {
        protocolBySession.set(note.session_id as string, `[Протокол сессии, аудиозаписи нет]\n${parts.join("\n")}`);
      }
    }
  }

  // Транскрипты уже анонимизированы при сохранении (см.
  // /api/webhooks/recording) — здесь просто собираем их в секции.
  // Протоколы, использованные как fallback, анонимизации не требуют —
  // психолог сам их писал руками и не вставляет туда идентификационные
  // данные клиента (в отличие от сырого транскрипта).
  const sortedSessions = [...sessions].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const sections: string[] = [];
  let sessionNumber = 0;
  for (const session of sortedSessions) {
    sessionNumber += 1;
    const text = latestBySession.get(session.id) ?? protocolBySession.get(session.id);
    if (!text) continue;
    const date = new Date(session.scheduled_at).toISOString().slice(0, 10);
    sections.push(`=== Сессия №${sessionNumber} от ${date} ===\n${text}`);
  }

  // Потолок стоимости среза: не больше PERIOD_SUMMARY_BUDGET_CHARS символов транскриптов
  // (≈20 тыс. токенов, ~1,5 ₽ на GigaChat-3-Pro). Если сессий много, каждая сокращается
  // поровну — сохраняются начало (жалоба, как прошла неделя) и конец (договорённости).
  const perSectionBudget = Math.floor(PERIOD_SUMMARY_BUDGET_CHARS / Math.max(1, sections.length));
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (sec.length > perSectionBudget) {
      const head = Math.floor(perSectionBudget * 0.6);
      const tail = perSectionBudget - head;
      sections[i] = sec.slice(0, head) + "\n[…середина сессии сокращена…]\n" + sec.slice(sec.length - tail);
    }
  }

  if (sections.length === 0) {
    throw new PeriodSummaryError("Ни для одной из выбранных сессий нет ни транскрипта, ни заполненного протокола");
  }

  const dateStart = new Date(sortedSessions[0].scheduled_at).toISOString().slice(0, 10);
  const dateEnd = new Date(sortedSessions[sortedSessions.length - 1].scheduled_at).toISOString().slice(0, 10);

  const periodSummaryMessages = [
    { role: "system" as const, text: PERIOD_SUMMARY_SYSTEM_PROMPT },
    {
      role: "user" as const,
      text: buildPeriodSummaryUserMessage({
        sessionsCount: sections.length,
        dateStart,
        dateEnd,
        transcripts: sections.join("\n\n"),
      }),
    },
  ];

  // Один автоматический повтор, если результат непригоден для показа
  // психологу — по любой из двух независимых причин, найденных 20.09
  // при тестировании "Уровень 1.1" на одном и том же вопросе про Катю:
  // (1) responseGuard считает итоговый текст небезопасным (см.
  // lib/agent/responseGuard.ts) — модель иногда пишет в одно из полей
  // JSON что-то похожее на snake_case-паттерн (дату, техническую
  // пометку), и GENERIC_TECHNICAL_PATTERN ложно срабатывает;
  // (2) одно из пяти полей JSON пустое/отсутствует (см.
  // hasAllPeriodSummaryFields выше) — без этой проверки
  // formatPeriodSummaryAsText подставляет буквальное "undefined" в текст.
  // Ни одна из причин не связана с чанкингом RAG и не баг в коде — это
  // нестабильность генерации. Ретрай почти не увеличивает стоимость
  // (повторный вызов стоит примерно как исходный).
  let result: PeriodSummaryResult;
  let summaryText: string;
  // Один и тот же X-Session-ID для попытки и повтора: у GigaChat повтор берёт транскрипты из кэша,
  // а токены из кэша не тарифицируются (без этого повтор стоил столько же, сколько первая попытка).
  const llmOptions = { sessionId: "tolk-ps-" + sessionIds.slice().sort().join(",").slice(0, 64) };
  try {
    result = normalizePeriodSummary(await yandexGptCompleteJson<unknown>(periodSummaryMessages, llmOptions));
    summaryText = formatPeriodSummaryAsText(result);
    if (!hasAllPeriodSummaryFields(result) || !checkResponseSafety(summaryText).safe) {
      result = normalizePeriodSummary(await yandexGptCompleteJson<unknown>(periodSummaryMessages, llmOptions));
      summaryText = formatPeriodSummaryAsText(result);
    }
  } catch (e) {
    throw new PeriodSummaryError(e instanceof YandexGptError ? e.message : "Не удалось сгенерировать срез");
  }
  if (!hasAllPeriodSummaryFields(result)) {
    console.error("PERIOD_SUMMARY_INCOMPLETE", JSON.stringify(Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.length]))));
    throw new PeriodSummaryError("Не удалось собрать срез: модель вернула неполный ответ. Попробуйте ещё раз.");
  }

  return {
    summaryText,
    structured: result,
    sectionsCount: sections.length,
    dateStart,
    dateEnd,
  };
}
