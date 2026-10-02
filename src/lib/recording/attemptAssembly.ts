// ============================================================
// Этап 3.1 (02.10.2026): сборка завершённой дорожки/попытки/сессии из
// session_recording_chunks перед отправкой в ASR (GigaAM, lib/asr.ts).
//
// Сознательно отделено от manifestValidation.ts: тот модуль отвечает
// за "можно ли считать дорожку/попытку целой" на уровне HTTP-роутов в
// момент записи (быстрая проверка без скачивания байт — см. его
// заголовок). Этот модуль — следующий шаг, уже после того как
// recording_status сессии дошёл до 'processing': здесь мы ДЕЙСТВИТЕЛЬНО
// скачиваем байты каждого фрагмента и сверяем checksum. НЕ дублирует
// проверку manifestValidation, а переповторяет её independently по
// сырым данным (defense in depth) — это осознанно: вызывающий код
// (будущий Этап 3.4 job-воркер) может запускаться и для попыток, у
// которых никогда не было собственного manifest (см. 'superseded'
// попытки ниже), поэтому доверять сохранённой validation недостаточно.
//
// СЕМАНТИКА checksum_verified — по migration_039_recording_checksum_
// verified.sql, строго: true выставляется РОВНО в момент успешной
// сверки реальных байт здесь, не на confirm (там сервер байт не видит
// при прямой загрузке — см. заголовок .../recording/chunks/route.ts).
// Несовпадение ОБЯЗАНО блокировать обработку дорожки, не только
// логироваться — это прямое требование из заголовка migration_039.
//
// ЭКСПЕРИМЕНТАЛЬНО, честная оговорка (см. src/lib/recording/types.ts,
// комментарий к RecordedChunk): склейка дорожки здесь — бинарная
// конкатенация подтверждённых фрагментов в порядке sequence, НЕ полный
// ffmpeg demux/remux. Для WebM/Opus, нарезанного MediaRecorder с
// фиксированным timeslice, заголовок контейнера есть только в первом
// фрагменте — на практике конкатенация часто даёт играбельный файл,
// но это предположение НЕ подтверждено реальным аудио в рамках этой
// работы (тесты ниже — на синтетических байтах). Перед тем как
// подавать результат в GigaAM на реальных сессиях, нужен отдельный
// живой Preview-тест с настоящей аудиозаписью (аналогично тому, как
// проверялась сама загрузка чанков 01-02.10) — если конкатенация не
// даёт играбельный файл, здесь потребуется настоящий ffmpeg remux,
// это отдельная и заметно более трудоёмкая задача.
//
// Модуль server-only (как и manifestValidation.ts): принимает уже
// готовый SupabaseClient (admin — нужен доступ на чтение/скачивание
// Storage независимо от RLS, см. createAdminClient() в
// src/lib/supabase/admin.ts), сам его не создаёт.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

const BUCKET = "session-recordings";
export type Track = "psychologist" | "client";
export const ASSEMBLY_TRACKS: readonly Track[] = ["psychologist", "client"] as const;

interface ChunkRow {
  sequence: number;
  storage_key: string;
  checksum: string;
  checksum_verified: boolean;
  size_bytes: number;
}

export type TrackAssemblyResult =
  | { ok: true; track: Track; buffer: Buffer; chunkCount: number; verifiedNow: number }
  | { ok: false; track: Track; reason: string; blockedAtSequence?: number; empty?: true };

export interface SessionAssemblyOk {
  ok: true;
  tracks: Partial<Record<Track, { buffer: Buffer; totalChunks: number }>>;
  attemptsUsed: string[];
}
export interface SessionAssemblyBlocked {
  ok: false;
  reason: string;
  attemptId?: string;
  track?: Track;
  /**
   * true — блокировка временная и САМА исчезнет позже без вмешательства
   * (сейчас это только случай "есть активная попытка" — запись либо
   * ещё идёт, либо недавно стартовала новая попытка после reload):
   * вызывающий код (см. jobQueue.ts, processNextRecordingJob) должен
   * вернуть задачу в очередь ('pending'), а не считать её сбоем.
   * Отсутствует/false — расхождение доказано и само не исчезнет (дыра,
   * checksum) — это реальный сбой, требующий внимания, не повтора.
   */
  transient?: boolean;
}
export type SessionAssemblyResult = SessionAssemblyOk | SessionAssemblyBlocked;

async function fetchOrderedChunks(
  supabase: SupabaseClient,
  sessionId: string,
  attemptId: string,
  track: Track
): Promise<ChunkRow[] | { error: string }> {
  const { data, error } = await supabase
    .from("session_recording_chunks")
    .select("sequence, storage_key, checksum, checksum_verified, size_bytes")
    .eq("session_id", sessionId)
    .eq("recording_attempt_id", attemptId)
    .eq("track", track)
    .order("sequence", { ascending: true });
  if (error) return { error: error.message };
  return (data ?? []) as unknown as ChunkRow[];
}

/** Первая позиция (индекс), где sequence не совпал с собственным индексом — то есть дыра в сквозной нумерации 0..N. null — дыр нет. */
function findGap(chunks: ChunkRow[]): number | null {
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].sequence !== i) return i;
  }
  return null;
}

async function downloadChunkBytes(
  supabase: SupabaseClient,
  storageKey: string
): Promise<{ buffer: Buffer } | { error: string }> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storageKey);
  if (error || !data) {
    return { error: `не удалось скачать фрагмент ${storageKey} из хранилища: ${error?.message ?? "нет данных"}` };
  }
  const arrayBuffer = await data.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer) };
}

/**
 * Собирает одну дорожку одной конкретной попытки записи. См. заголовок
 * файла — это, а не manifestValidation.validateTrack, единственное
 * место, выставляющее checksum_verified=true (и единственное место,
 * реально скачивающее байты фрагментов).
 */
export async function assembleAttemptTrack(
  supabase: SupabaseClient,
  params: { sessionId: string; attemptId: string; track: Track }
): Promise<TrackAssemblyResult> {
  const { sessionId, attemptId, track } = params;

  const chunks = await fetchOrderedChunks(supabase, sessionId, attemptId, track);
  if ("error" in chunks) {
    return { ok: false, track, reason: `не удалось прочитать реестр фрагментов: ${chunks.error}` };
  }
  if (chunks.length === 0) {
    return { ok: false, track, reason: "дорожка не записывалась в этой попытке (0 подтверждённых фрагментов)", empty: true };
  }

  const gapAt = findGap(chunks);
  if (gapAt !== null) {
    return {
      ok: false,
      track,
      reason: `дыра в нумерации фрагментов на позиции ${gapAt} (ожидался sequence=${gapAt})`,
      blockedAtSequence: gapAt,
    };
  }

  const buffers: Buffer[] = [];
  let verifiedNow = 0;

  for (const chunk of chunks) {
    const bytes = await downloadChunkBytes(supabase, chunk.storage_key);
    if ("error" in bytes) {
      return { ok: false, track, reason: bytes.error, blockedAtSequence: chunk.sequence };
    }

    if (chunk.checksum_verified) {
      // Уже сверен раньше (идемпотентный повторный запуск сборки —
      // см. Этап 3.4, job-воркер может перезапускаться после сбоя) —
      // байты всё равно нужны для склейки, но пересчитывать и сверять
      // checksum заново не нужно: сверка не кэширует сами байты, но
      // кэширует её РЕЗУЛЬТАТ, и повторная сверка не изменит решение,
      // принятое раньше по тем же неизменяемым данным в Storage.
      buffers.push(bytes.buffer);
      continue;
    }

    const actualChecksum = `sha256:${createHash("sha256").update(bytes.buffer).digest("hex")}`;
    if (actualChecksum !== chunk.checksum) {
      // Прямое требование заголовка migration_039: несовпадение
      // ОБЯЗАНО блокировать обработку дорожки, не только логировать.
      return {
        ok: false,
        track,
        reason:
          `контрольная сумма фрагмента ${chunk.sequence} не совпала — файл повреждён или подменён ` +
          `(заявлено ${chunk.checksum}, реально ${actualChecksum})`,
        blockedAtSequence: chunk.sequence,
      };
    }

    const { error: updateError } = await supabase
      .from("session_recording_chunks")
      .update({ checksum_verified: true })
      .eq("recording_attempt_id", attemptId)
      .eq("track", track)
      .eq("sequence", chunk.sequence);
    if (updateError) {
      return {
        ok: false,
        track,
        reason: `сверка checksum прошла успешно, но не удалось сохранить checksum_verified: ${updateError.message}`,
        blockedAtSequence: chunk.sequence,
      };
    }

    verifiedNow++;
    buffers.push(bytes.buffer);
  }

  return { ok: true, track, buffer: Buffer.concat(buffers), chunkCount: chunks.length, verifiedNow };
}

/**
 * Собирает ВСЮ консультацию: по очереди (в хронологическом порядке
 * started_at) проходит ВСЕ recording_attempts сессии — не только
 * последнюю — и для каждой склеивает обе дорожки через
 * assembleAttemptTrack(), затем склеивает результаты МЕЖДУ попытками
 * в ту же хронологическую последовательность. Это и есть ответ на
 * открытый вопрос "что считать записью консультации, если психолог
 * перезагрузил вкладку посреди звонка (reload/retry)" — см.
 * recording_attempts.status в migration_038: 'superseded' попытки
 * не считаются мусором, их подтверждённые фрагменты — часть записи,
 * если сами по себе целы.
 *
 * СТРОГО по требованию (запрет обработки при незавершённой/дырявой/
 * невалидной попытке): если ЛЮБАЯ попытка, у которой на дорожке есть
 * хоть один подтверждённый фрагмент, не прошла assembleAttemptTrack —
 * вся сборка сессии блокируется целиком, частичный результат не
 * возвращается. "Пустая" дорожка конкретной попытки (track вообще не
 * записывался в этом заходе — например, клиент не был на связи во
 * время повторной попытки) — это НЕ ошибка и не блокирует остальное.
 *
 * Отдельно блокирует сборку, если у сессии есть попытка со
 * status='active': это означает, что запись либо ещё идёт, либо
 * завершилась нештатно без manifest (аварийное закрытие вкладки без
 * повторного захода) — в обоих случаях решать судьбу этой попытки
 * раньше срока нельзя.
 */
export async function assembleSessionRecording(
  supabase: SupabaseClient,
  sessionId: string
): Promise<SessionAssemblyResult> {
  const { data: attempts, error } = await supabase
    .from("recording_attempts")
    .select("id, status, started_at")
    .eq("session_id", sessionId)
    .order("started_at", { ascending: true });
  if (error) {
    return { ok: false, reason: `не удалось прочитать попытки записи сессии: ${error.message}` };
  }
  if (!attempts || attempts.length === 0) {
    return { ok: false, reason: "по сессии не найдено ни одной попытки записи" };
  }

  const activeAttempt = (attempts as Array<{ id: string; status: string }>).find(a => a.status === "active");
  if (activeAttempt) {
    return {
      ok: false,
      reason:
        "есть незавершённая попытка записи (status='active') — запись либо ещё идёт, либо завершилась " +
        "нештатно без manifest; сборка сессии до её завершения не выполняется",
      attemptId: activeAttempt.id,
      transient: true,
    };
  }

  const perTrackBuffers: Partial<Record<Track, Buffer[]>> = {};
  const perTrackChunks: Partial<Record<Track, number>> = {};
  const attemptsUsed: string[] = [];

  for (const attempt of attempts as Array<{ id: string; status: string }>) {
    attemptsUsed.push(attempt.id);
    for (const track of ASSEMBLY_TRACKS) {
      const result = await assembleAttemptTrack(supabase, { sessionId, attemptId: attempt.id, track });
      if (!result.ok) {
        if (result.empty) continue; // дорожка просто не записывалась в этой попытке — не ошибка
        return {
          ok: false,
          reason: `попытка ${attempt.id} (status=${attempt.status}), дорожка ${track}: ${result.reason}`,
          attemptId: attempt.id,
          track,
        };
      }
      (perTrackBuffers[track] ??= []).push(result.buffer);
      perTrackChunks[track] = (perTrackChunks[track] ?? 0) + result.chunkCount;
    }
  }

  const tracks: SessionAssemblyOk["tracks"] = {};
  for (const track of ASSEMBLY_TRACKS) {
    const list = perTrackBuffers[track];
    if (list && list.length > 0) {
      tracks[track] = { buffer: Buffer.concat(list), totalChunks: perTrackChunks[track] ?? 0 };
    }
  }

  if (!tracks.psychologist && !tracks.client) {
    return { ok: false, reason: "ни одна дорожка ни в одной попытке не содержит подтверждённых фрагментов" };
  }

  return { ok: true, tracks, attemptsUsed };
}
