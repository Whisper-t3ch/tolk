import type { SupabaseClient } from "@supabase/supabase-js";
import { anonymizeTranscript } from "@/lib/anonymize";
import { chunkAndEmbedTranscript } from "@/lib/transcriptChunking";

// ------------------------------------------------------------
// Общая логика сохранения вручную введённого транскрипта — вынесена из
// api/sessions/[id]/transcript/route.ts, чтобы её мог переиспользовать
// новый путь "загрузить транскрипт при создании клиента"
// (api/clients/[id]/transcript/route.ts) без копирования пайплайна
// анонимизация → session_transcripts insert → чанкинг+embedding.
//
// Всегда: анонимизация ДО первой записи в БД (raw_text в базе — уже
// анонимизированный текст), затем чанкинг на ~4000 символов и embedding
// на каждый чанк отдельно (best-effort — см. lib/transcriptChunking.ts,
// YandexGPT Embeddings ограничен 2048 токенами на вход).
// ------------------------------------------------------------
export async function saveSessionTranscript(
  supabase: SupabaseClient,
  sessionId: string,
  clientName: string,
  text: string
): Promise<{ chunksTotal: number; chunksEmbedded: number }> {
  const anonymizedText = await anonymizeTranscript(text, clientName);

  const { error: insertError } = await supabase.from("session_transcripts").insert({
    session_id: sessionId,
    raw_text: anonymizedText,
    source: "manual",
    // embedding на уровне целой сессии не считаем — RAG работает через
    // session_transcript_chunks, эта колонка остаётся NULL.
    embedding: null,
  });
  if (insertError) {
    throw new Error(insertError.message);
  }

  const { chunksTotal, chunksEmbedded } = await chunkAndEmbedTranscript(supabase, sessionId, anonymizedText);

  await supabase
    .from("sessions")
    .update({ recording_status: "ready", transcript_error: null })
    .eq("id", sessionId);

  return { chunksTotal, chunksEmbedded };
}
