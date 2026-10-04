// ============================================================
// Входные материалы для черновика протокола: транскрипт, заметки
// психолога, резюме прошлых сессий. Общий загрузчик для запуска
// генерации (api/.../soap/generate) и для пост-проверки результата
// (api/.../soap/generate/status) — чтобы проверка «только из записи»
// сверялась с теми же данными, что видела модель.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { maskProfanity } from "@/lib/profanity";

export interface SoapSourceMaterial {
  /** Транскрипт (уже анонимизированный при сохранении) с замаскированным матом, либо undefined. */
  transcript?: string;
  transcriptDurationSeconds: number | null;
  /** Заметки психолога (текущие s/o/a/p) с замаскированным матом. */
  notes: string;
  previousSessionsSummary?: string;
  sessionNumber: number;
}

export async function loadSoapSourceMaterial(
  supabase: SupabaseClient,
  params: { sessionId: string; clientId: string; psychologistId: string }
): Promise<SoapSourceMaterial> {
  const { sessionId, clientId, psychologistId } = params;

  const { data: transcript } = await supabase
    .from("session_transcripts")
    .select("raw_text, duration_seconds")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: existingNote } = await supabase
    .from("soap_notes")
    .select("s_subjective, o_objective, a_assessment, p_plan")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const notes = [existingNote?.s_subjective, existingNote?.o_objective, existingNote?.a_assessment, existingNote?.p_plan]
    .map(v => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .join("\n\n");

  const { data: clientSessions } = await supabase
    .from("sessions")
    .select("id, scheduled_at")
    .eq("client_id", clientId)
    .eq("psychologist_id", psychologistId)
    .order("scheduled_at", { ascending: true });

  const orderedIds = (clientSessions ?? []).map(s => s.id as string);
  const sessionNumber = Math.max(1, orderedIds.indexOf(sessionId) + 1);
  const previousSessionIds = orderedIds.slice(0, Math.max(0, orderedIds.indexOf(sessionId))).slice(-3);

  let previousSessionsSummary: string | undefined;
  if (previousSessionIds.length > 0) {
    const { data: previousNotes } = await supabase
      .from("soap_notes")
      .select("session_id, a_assessment, p_plan")
      .in("session_id", previousSessionIds);
    if (previousNotes && previousNotes.length > 0) {
      previousSessionsSummary =
        previousNotes
          .map(n => {
            const gist = [n.a_assessment, n.p_plan].filter(Boolean).join(" ");
            return gist ? `— ${gist}` : null;
          })
          .filter(Boolean)
          .join("\n") || undefined;
    }
  }

  const rawTranscript = typeof transcript?.raw_text === "string" ? transcript.raw_text : "";
  return {
    transcript: rawTranscript ? maskProfanity(rawTranscript) : undefined,
    transcriptDurationSeconds: typeof transcript?.duration_seconds === "number" ? transcript.duration_seconds : null,
    notes: maskProfanity(notes),
    previousSessionsSummary: previousSessionsSummary ? maskProfanity(previousSessionsSummary) : undefined,
    sessionNumber,
  };
}

/** Весь текст, который видела модель, — основа для пост-проверки «только из записи». */
export function buildGroundingCorpus(material: SoapSourceMaterial): string {
  return [
    material.transcript ?? "",
    material.notes,
    material.previousSessionsSummary ?? "",
    `Сессия №${material.sessionNumber}`,
  ].join("\n");
}
