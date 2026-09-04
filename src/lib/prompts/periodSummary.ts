// ============================================================
// Промпт и общая логика построения периодического среза по клиенту
// (period_summaries). Тяжёлый запрос — списывает 3 из лимита ассистента
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
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { yandexGptCompleteJson, YandexGptError } from "@/lib/yandexgpt";

export const PERIOD_SUMMARY_SYSTEM_PROMPT = `Ты клинический ассистент психолога.
На основе транскриптов нескольких сессий с одним клиентом составь обобщённое резюме на русском языке.
Выдели: ключевые темы работы, динамику состояния клиента, прогресс, повторяющиеся паттерны, незакрытые вопросы.
Ответь в формате JSON:
{"key_themes": "string", "dynamics": "string", "progress": "string", "patterns": "string", "open_questions": "string"}`;

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

  // Транскрипты уже анонимизированы при сохранении (см.
  // /api/webhooks/recording) — здесь просто собираем их в секции.
  const sortedSessions = [...sessions].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const sections: string[] = [];
  let sessionNumber = 0;
  for (const session of sortedSessions) {
    sessionNumber += 1;
    const text = latestBySession.get(session.id);
    if (!text) continue;
    const date = new Date(session.scheduled_at).toISOString().slice(0, 10);
    sections.push(`=== Сессия №${sessionNumber} от ${date} ===\n${text}`);
  }

  if (sections.length === 0) {
    throw new PeriodSummaryError("Ни для одной из выбранных сессий транскрипт не готов");
  }

  const dateStart = new Date(sortedSessions[0].scheduled_at).toISOString().slice(0, 10);
  const dateEnd = new Date(sortedSessions[sortedSessions.length - 1].scheduled_at).toISOString().slice(0, 10);

  let result: PeriodSummaryResult;
  try {
    result = await yandexGptCompleteJson<PeriodSummaryResult>([
      { role: "system", text: PERIOD_SUMMARY_SYSTEM_PROMPT },
      {
        role: "user",
        text: buildPeriodSummaryUserMessage({
          sessionsCount: sections.length,
          dateStart,
          dateEnd,
          transcripts: sections.join("\n\n"),
        }),
      },
    ]);
  } catch (e) {
    throw new PeriodSummaryError(e instanceof YandexGptError ? e.message : "Не удалось сгенерировать срез");
  }

  return {
    summaryText: formatPeriodSummaryAsText(result),
    structured: result,
    sectionsCount: sections.length,
    dateStart,
    dateEnd,
  };
}
