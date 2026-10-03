// ============================================================
// Этап 3.5 (02.10.2026): сведение двух дорожек в единый диалог со
// спикерами, анонимизация, сохранение в session_transcripts/
// session_transcript_segments, RAG-чанкинг — связывает
// assembleSessionRecording (Этап 3.1) и injected AsrAdapter (см.
// asrAdapter.ts) с уже существующим пайплайном SOAP/RAG, который
// menять не нужно (см. migration_036_browser_recording.sql:
// "session_transcripts.raw_text остаётся источником для SOAP... весь
// существующий пайплайн продолжает работать без изменений").
//
// ЧЕСТНАЯ ОГОВОРКА про сведение по времени: startMs/endMs сегментов —
// относительные к НАЧАЛУ СОБРАННОЙ ДОРОЖКИ (buffer из
// assembleSessionRecording), не абсолютное время сессии. Для сессии
// БЕЗ reload (одна попытка) это совпадает с реальным временем
// разговора с точностью ASR. Если было несколько попыток (reload —
// см. attemptAssembly.assembleSessionRecording, который склеивает
// попытки подряд), пауза МЕЖДУ попытками (время, пока психолог
// перезагружал страницу) сейчас НЕ учитывается — сегменты второй
// попытки сдвинуты только на длительность аудио первой попытки, не
// на реальное календарное время между ними. Известное ограничение,
// не решается в этом заходе — чтобы закрыть его точно, нужно
// протащить started_at_ms/duration_ms исходных чанков через сборку
// (сейчас assembleAttemptTrack отдаёт только склеенный Buffer, без
// этих меток) и восстановить реальные паузы. Для одной попытки (явно
// преобладающий случай) эффекта нет.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { anonymizeTranscripts } from "@/lib/anonymize";
import { chunkAndEmbedTranscript } from "@/lib/transcriptChunking";
import { ASSEMBLY_TRACKS, type SessionAssemblyOk, type Track } from "./attemptAssembly";
import type { AsrAdapter, AsrTrackResult } from "./asrAdapter";
import type { JobOutcome } from "./jobQueue";

const SPEAKER_LABEL: Record<Track, string> = { psychologist: "Психолог", client: "Клиент" };

interface MergedSegment {
  speaker: Track;
  startMs: number;
  endMs: number;
  text: string;
}

/** Сводит сегменты обеих дорожек в один список по возрастанию startMs (стабильная сортировка — при равенстве сохраняется порядок добавления: сперва psychologist, затем client для одного и того же startMs). */
export function mergeTrackResults(tracks: Partial<Record<Track, AsrTrackResult>>): MergedSegment[] {
  const merged: MergedSegment[] = [];
  for (const track of ASSEMBLY_TRACKS) {
    const result = tracks[track];
    if (!result) continue;
    for (const segment of result.segments) {
      // Реальный ASR превращает тишину в сегменты из одной пунктуации ("."): без букв и цифр не нужны ни в диалоге, ни в SOAP.
      if (!/[\p{L}\p{N}]/u.test(segment.text)) continue;
      merged.push({ speaker: track, startMs: segment.startMs, endMs: segment.endMs, text: segment.text });
    }
  }
  return merged
    .map((segment, originalIndex) => ({ segment, originalIndex }))
    .sort((a, b) => (a.segment.startMs !== b.segment.startMs ? a.segment.startMs - b.segment.startMs : a.originalIndex - b.originalIndex))
    .map(({ segment }) => segment);
}

async function fetchClientName(supabase: SupabaseClient, sessionId: string): Promise<string> {
  const { data } = await supabase
    .from("sessions")
    .select("clients ( name )")
    .eq("id", sessionId)
    .maybeSingle();
  const clientRel = Array.isArray(data?.clients) ? data?.clients[0] : data?.clients;
  return (clientRel as { name?: string } | null)?.name ?? "Клиент";
}

/**
 * Полный пайплайн Этапа 3.5 для одной сессии: ASR по обеим дорожкам →
 * сведение по времени → анонимизация ПО СЕГМЕНТАМ (не склеенного
 * текста целиком) → session_transcripts (source='jitsi_browser',
 * см. migration_036) + session_transcript_segments → RAG-чанкинг
 * (chunkAndEmbedTranscript — тот же, что уже использует старый
 * webhooks/recording путь, без изменений).
 *
 * Анонимизация именно по сегментам (anonymizeTranscripts — уже
 * существующий helper для параллельной анонимизации нескольких
 * текстов), а не по склеенному диалогу целиком — чтобы
 * session_transcript_segments.text гарантированно совпадал с тем, из
 * чего построен session_transcripts.raw_text (dialogueText строится
 * ИЗ уже анонимизированных сегментов), без риска рассинхронизации
 * между ними. Минус — анонимизация каждого сегмента видит меньше
 * контекста, чем весь диалог целиком; для первого прохода (Этап 3.5)
 * это принятый компромисс, не являющийся сейчас открытым вопросом.
 *
 * Вызывается из transcribe()-callback в /api/jobs/process — см. его
 * заголовок про выбор адаптера (mock/http) через RECORDING_ASR_ADAPTER.
 */
export async function transcribeAssembledSession(
  supabase: SupabaseClient,
  params: { sessionId: string; assembly: SessionAssemblyOk; adapter: AsrAdapter }
): Promise<JobOutcome> {
  const { sessionId, assembly, adapter } = params;

  const trackResults: Partial<Record<Track, AsrTrackResult>> = {};
  for (const track of ASSEMBLY_TRACKS) {
    const trackData = assembly.tracks[track];
    if (!trackData) continue;
    try {
      trackResults[track] = await adapter.transcribeTrack(trackData.buffer, track);
    } catch (e) {
      return { kind: "failed", reason: `ASR не смог обработать дорожку "${track}": ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  const merged = mergeTrackResults(trackResults);
  if (merged.length === 0) {
    return { kind: "failed", reason: "ASR вернул пустой транскрипт по обеим дорожкам" };
  }

  const clientName = await fetchClientName(supabase, sessionId);
  const anonymizedTexts = await anonymizeTranscripts(merged.map(s => s.text), clientName);
  const anonymizedSegments = merged.map((segment, i) => ({ ...segment, text: anonymizedTexts[i] ?? segment.text }));
  const dialogueText = anonymizedSegments.map(s => `${SPEAKER_LABEL[s.speaker]}: ${s.text}`).join("\n\n");

  // session_transcripts.duration_seconds — integer: реальный ASR отдаёт дробные секунды
  // (например 300.72), mock отдавал целые, поэтому округляем здесь.
  const durationSeconds = Math.round(
    Math.max(0, ...Object.values(trackResults).map(r => r?.durationSeconds ?? 0))
  );

  const { data: transcriptRow, error: transcriptError } = await supabase
    .from("session_transcripts")
    .insert({
      session_id: sessionId,
      raw_text: dialogueText,
      source: "jitsi_browser",
      duration_seconds: durationSeconds || null,
      embedding: null,
    })
    .select("id")
    .single();
  if (transcriptError || !transcriptRow) {
    return { kind: "failed", reason: `не удалось сохранить транскрипт: ${transcriptError?.message ?? "unknown error"}` };
  }

  const segmentRows = anonymizedSegments.map((s, i) => ({
    session_id: sessionId,
    speaker: s.speaker,
    ordinal: i,
    start_ms: Math.max(0, Math.round(s.startMs)),
    end_ms: Math.max(0, Math.round(s.endMs)),
    text: s.text,
  }));
  const { error: segmentsError } = await supabase.from("session_transcript_segments").insert(segmentRows);
  if (segmentsError) {
    // Best-effort, как и в webhooks/recording для чанкинга ниже:
    // сегменты — детализация СВЕРХ основного транскрипта (см.
    // migration_036), транскрипт для SOAP уже сохранён выше — не
    // проваливаем всю задачу из-за этого.
    console.error(`transcribeAssembledSession: не удалось сохранить session_transcript_segments для ${sessionId}:`, segmentsError.message);
  }

  const { chunksTotal, chunksEmbedded } = await chunkAndEmbedTranscript(supabase, sessionId, dialogueText);
  if (chunksEmbedded < chunksTotal) {
    console.error(`transcribeAssembledSession: не все чанки транскрипта проиндексированы для ${sessionId}: ${chunksEmbedded}/${chunksTotal}`);
  }

  return {
    kind: "completed",
    result: { transcriptId: transcriptRow.id, segments: segmentRows.length, chunksTotal, chunksEmbedded },
  };
}
