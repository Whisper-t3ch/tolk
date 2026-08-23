// ============================================================
// Промпт для периодического среза по клиенту (period_summaries).
// Тяжёлый запрос — списывает 3 из лимита ассистента (см.
// src/lib/assistantLimits.ts, ASSISTANT_REQUEST_COST.heavy).
// ============================================================

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
