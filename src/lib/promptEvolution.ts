import type { SupabaseClient } from "@supabase/supabase-js";

// ------------------------------------------------------------
// Точка входа для системы самоулучшения ассистента по approach
// (см. migration_009_assistant_self_improvement.sql). Разделяет
// системный промпт на две независимые части:
//
//   - base_prompt (AGENT_SYSTEM_PROMPT в lib/agent/tools.ts) — этика,
//     безопасность, структура ответа. НИКОГДА не редактируется
//     автоматикой, меняется только вручную в коде.
//   - prompt_additions — инкрементальные добавки по стилю/терминологии
//     для конкретного approach, читаются из активной записи
//     prompt_versions. Пока cron-анализ (пп. 3-5 ТЗ) не реализован,
//     активных версий в БД нет ни для одного approach — функция ниже
//     в этом случае просто возвращает пустую строку, поведение
//     промпта не меняется по сравнению с тем, что было раньше.
//
// A/B-логика (использование testing-версии с вероятностью
// traffic_percentage) сюда сознательно не добавлена — это пункт 4
// ТЗ, отложенный до накопления данных на бете (см. задачи #57-59).
// Сейчас всегда читается только active-версия.
// ------------------------------------------------------------

export interface ActivePromptAdditions {
  text: string;
  promptVersionId: string | null;
}

export async function getActivePromptAdditions(
  supabase: SupabaseClient,
  approach: string | null
): Promise<ActivePromptAdditions> {
  if (!approach) return { text: "", promptVersionId: null };

  const { data } = await supabase
    .from("prompt_versions")
    .select("id, prompt_additions")
    .eq("approach", approach)
    .eq("status", "active")
    .maybeSingle();

  if (!data) return { text: "", promptVersionId: null };
  return { text: data.prompt_additions ?? "", promptVersionId: data.id };
}

// ------------------------------------------------------------
// Сохранение обратной связи по ответу ассистента. Вызывается сразу
// после того, как ответ сформирован и отправлен психологу — rating
// по умолчанию 'neutral', обновляется позже явным вызовом
// POST /api/assistant/feedback или неявными сигналами (was_used,
// was_reformulated).
// ------------------------------------------------------------
export interface RecordAssistantFeedbackInput {
  psychologistId: string;
  approach: string | null;
  agentSessionId: string | null;
  messageId: string;
  question: string;
  answer: string;
  promptVersionId: string | null;
}

export async function recordAssistantFeedback(
  supabase: SupabaseClient,
  input: RecordAssistantFeedbackInput
): Promise<void> {
  // approach обязателен в схеме (not null) — если психолог ещё не
  // прошёл онбординг и approach не задан, используем 'other', чтобы
  // не терять запись и не блокировать сохранение диалога из-за
  // побочной аналитики.
  const { error } = await supabase.from("assistant_feedback").insert({
    psychologist_id: input.psychologistId,
    approach: input.approach ?? "other",
    agent_session_id: input.agentSessionId,
    message_id: input.messageId,
    question: input.question,
    answer: input.answer,
    prompt_version_id: input.promptVersionId,
  });

  // Фидбек — вспомогательная аналитика, не должна ронять основной
  // ответ ассистента психологу, поэтому ошибку только логируем.
  if (error) {
    console.error("Не удалось сохранить assistant_feedback:", error.message);
  }
}
