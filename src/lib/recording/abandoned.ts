// Добивание «брошенных» записей. Если психолог закрыл вкладку/сел телефон во время сессии,
// браузер не успевает отправить manifest, и sessions.recording_status навсегда остаётся
// 'recording' (или 'uploading'), хотя фрагменты уже лежат в реестре. Воркер (раз в минуту)
// вызывает finalizeAbandonedRecordings: по реестру строит manifest сам, сверяет и ставит
// расшифровку в очередь — так же, как это сделал бы штатный manifest-роут.
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateTrack, computeFinalStatus, type TrackValidation } from "@/lib/recording/manifestValidation";
import { enqueueTranscriptionJob } from "@/lib/recording/jobQueue";

/** Сколько без heartbeat считаем запись брошенной (heartbeat идёт каждые ~12 с). */
export const ABANDONED_RECORDING_MS = 10 * 60_000;
/** 'uploading' ждёт дозагрузки дольше — даём больше времени. */
export const ABANDONED_UPLOADING_MS = 20 * 60_000;

export interface ChunkRef { track: string; sequence: number; recording_attempt_id: string | null }
export interface PlannedTrack {
  role: "psychologist" | "client";
  chunkCount: number;
  firstSequence: number;
  lastSequence: number;
}

/** Чистая функция: из строк реестра одной попытки — заявленные дорожки. */
export function planTracksFromChunks(rows: ChunkRef[]): PlannedTrack[] {
  const out: PlannedTrack[] = [];
  for (const role of ["psychologist", "client"] as const) {
    const seqs = rows.filter(r => r.track === role).map(r => r.sequence).sort((a, b) => a - b);
    if (seqs.length === 0) continue;
    out.push({ role, chunkCount: seqs.length, firstSequence: seqs[0], lastSequence: seqs[seqs.length - 1] });
  }
  return out;
}

export interface AbandonedResult { sessionId: string; status: string; queued: boolean }

async function finalizeOne(admin: SupabaseClient, sessionId: string): Promise<AbandonedResult> {
  const { data: rows, error } = await admin
    .from("session_recording_chunks")
    .select("track, sequence, recording_attempt_id, uploaded_at")
    .eq("session_id", sessionId)
    .order("uploaded_at", { ascending: false })
    .limit(20000);
  if (error) throw new Error(error.message);

  const all = (rows ?? []) as (ChunkRef & { uploaded_at?: string })[];
  // Берём последнюю попытку, в которую реально писались фрагменты.
  const attemptId = all.find(r => r.recording_attempt_id)?.recording_attempt_id ?? null;
  const ofAttempt = attemptId ? all.filter(r => r.recording_attempt_id === attemptId) : all;
  const tracks = planTracksFromChunks(ofAttempt);
  const nowIso = new Date().toISOString();

  if (tracks.length === 0) {
    await admin.from("sessions").update({ recording_status: "incomplete", recording_heartbeat_at: nowIso }).eq("id", sessionId);
    return { sessionId, status: "incomplete", queued: false };
  }

  const validations: TrackValidation[] = await Promise.all(
    tracks.map(t => validateTrack(admin, sessionId, attemptId, { ...t, state: "abandoned" }))
  );
  const status = computeFinalStatus(validations);
  const manifest = {
    sessionId,
    attemptId,
    abandoned: true,
    finishedAt: nowIso,
    tracks: tracks.map(t => ({ ...t, mimeType: null, totalDurationMs: 0, state: "abandoned" })),
    validation: validations,
  };
  const { error: upErr } = await admin
    .from("sessions")
    .update({ recording_status: status, recording_manifest: manifest, recording_heartbeat_at: nowIso })
    .eq("id", sessionId);
  if (upErr) throw new Error(upErr.message);

  if (attemptId) {
    await admin
      .from("recording_attempts")
      .update({ status: "completed", ended_at: nowIso })
      .eq("id", attemptId)
      .eq("session_id", sessionId)
      .eq("status", "active");
  }

  let queued = false;
  if (status === "processing") {
    const r = await enqueueTranscriptionJob(admin, sessionId);
    queued = r.ok;
    if (!r.ok) console.error("ABANDONED_ENQUEUE_FAILED", sessionId, r.error);
  }
  console.log("RECORDING_ABANDONED_FINALIZED", JSON.stringify({ sessionId, status, queued, tracks: tracks.length }));
  return { sessionId, status, queued };
}

/** Находит брошенные записи и добивает их. Не больше `limit` за вызов; ошибки одной сессии не мешают остальным. */
export async function finalizeAbandonedRecordings(admin: SupabaseClient, limit = 5, now = Date.now()): Promise<AbandonedResult[]> {
  const out: AbandonedResult[] = [];
  const cutoffRec = new Date(now - ABANDONED_RECORDING_MS).toISOString();
  const cutoffUp = new Date(now - ABANDONED_UPLOADING_MS).toISOString();

  const ids: string[] = [];
  const { data: rec } = await admin
    .from("sessions").select("id").eq("recording_status", "recording").lt("recording_heartbeat_at", cutoffRec).limit(limit);
  for (const r of rec ?? []) ids.push(r.id as string);
  const { data: up } = await admin
    .from("sessions").select("id").eq("recording_status", "uploading").lt("recording_heartbeat_at", cutoffUp).limit(limit);
  for (const r of up ?? []) ids.push(r.id as string);

  for (const id of ids.slice(0, limit)) {
    try {
      out.push(await finalizeOne(admin, id));
    } catch (e) {
      console.error("ABANDONED_FINALIZE_FAILED", id, e instanceof Error ? e.message : e);
    }
  }
  return out;
}
