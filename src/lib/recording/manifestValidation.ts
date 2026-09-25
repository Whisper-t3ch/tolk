// ============================================================
// Серверная сверка целостности записи по attempt_id — общее для
// /recording/manifest (первичная проверка сразу после stop()) и
// /recording/chunks confirm-роута (пересчёт статуса по мере поздней
// дозагрузки, см. claude/recording-stop-fix-plan.md в проекте).
// Вынесено в отдельный модуль 25.09.2026, чтобы оба route.ts вызывали
// ОДНУ и ту же логику вместо двух копий, которые рано или поздно
// разойдутся.
//
// Модуль server-only: принимает уже готовый SupabaseClient, сам его
// не создаёт и не содержит секретов. НЕ импортируется из браузерного
// кода — остальной src/lib/recording/ (trackRecorder.ts и соседи)
// используется в браузере, этот файл — только из route.ts.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ManifestTrackInput {
  role: string;
  chunkCount: number;
  firstSequence: number;
  lastSequence: number;
  state: string;
}

export interface TrackValidation {
  role: string;
  ok: boolean;
  reason?: string;
  /**
   * true — расхождение может само исчезнуть по мере дозагрузки
   * (браузер не смог подтвердить факт остановки MediaRecorder, см.
   * TrackRecorder.stop() в trackRecorder.ts), это НЕ факт потери
   * данных. false/отсутствует — расхождение уже сейчас доказано
   * (дыра в нумерации, дорожка не писалась) и само не исчезнет.
   */
  unresolved?: boolean;
}

async function fetchSequences(
  supabase: SupabaseClient,
  sessionId: string,
  attemptId: string | null,
  role: string
): Promise<number[] | { error: string }> {
  let query = supabase
    .from("session_recording_chunks")
    .select("sequence")
    .eq("session_id", sessionId)
    .eq("track", role);
  if (attemptId) {
    query = query.eq("recording_attempt_id", attemptId);
  }
  const { data: rows, error } = await query.order("sequence", { ascending: true });
  if (error) return { error: error.message };
  return (rows ?? []).map(r => r.sequence as number);
}

/**
 * Основная сверка — вызывается из /recording/manifest сразу после
 * stop(). track.state==="failed" (TrackRecorder НЕ подтвердил
 * остановку — см. trackRecorder.ts) даёт unresolved:true независимо
 * от счётчиков: раз браузер сам не уверен, что дорожка дописана,
 * сверка заявленного chunkCount с реестром ничего не доказывает —
 * реестр может ещё расти после этого момента.
 */
export async function validateTrack(
  supabase: SupabaseClient,
  sessionId: string,
  attemptId: string | null,
  track: ManifestTrackInput
): Promise<TrackValidation> {
  if (track.state === "failed") {
    return {
      role: track.role,
      ok: false,
      unresolved: true,
      reason:
        "остановка записи не была подтверждена браузером — дорожка могла продолжать писаться дольше заявленного; статус обновится по мере дозагрузки",
    };
  }

  const sequences = await fetchSequences(supabase, sessionId, attemptId, track.role);
  if ("error" in sequences) {
    return { role: track.role, ok: false, reason: `Не удалось прочитать реестр фрагментов: ${sequences.error}` };
  }
  const actualCount = sequences.length;

  if (track.chunkCount <= 0) {
    if (actualCount !== 0) {
      return {
        role: track.role,
        ok: false,
        reason: `manifest заявляет 0 фрагментов, но в реестре есть ${actualCount} — расхождение`,
      };
    }
    return { role: track.role, ok: false, reason: "дорожка не записывалась (0 фрагментов)" };
  }

  if (actualCount !== track.chunkCount) {
    return {
      role: track.role,
      ok: false,
      reason: `ожидалось ${track.chunkCount} фрагментов по manifest, в реестре ${actualCount}`,
    };
  }

  for (let i = 0; i < sequences.length; i++) {
    if (sequences[i] !== i) {
      return { role: track.role, ok: false, reason: `дыра в нумерации на позиции ${i} (sequence=${sequences[i]})` };
    }
  }

  if (sequences[0] !== track.firstSequence || sequences[sequences.length - 1] !== track.lastSequence) {
    return { role: track.role, ok: false, reason: "диапазон sequence не совпал с manifest" };
  }

  return { role: track.role, ok: true };
}

/**
 * Сколько ждать с момента manifest.finishedAt, прежде чем окончательно
 * решить судьбу unresolved-дорожки (см. checkUnresolvedTrack ниже),
 * вместо того чтобы бесконечно держать статус 'uploading'. Заметно
 * больше одного timeslice (20с) и одного шага retry (до 20с) —
 * см. DEFAULT_TIMESLICE_MS/RETRY_DELAYS_MS.
 *
 * ИЗВЕСТНОЕ ОГРАНИЧЕНИЕ (осознанно не решается в этом заходе, см.
 * claude/recording-stop-fix-plan.md): пересчёт запускается только по
 * СОБЫТИЮ следующего confirm для этой попытки. Если дозагрузка
 * оборвалась насовсем (фрагменты больше никогда не подтвердятся),
 * триггера пересчитать и закрыть этот grace-период не будет — статус
 * останется 'uploading' до следующего подтверждённого фрагмента,
 * которого может и не быть. Полное решение требует периодической
 * задачи (cron) вне HTTP-запроса; здесь её нет.
 */
export const UNRESOLVED_GRACE_MS = 45_000;

/**
 * Пересчёт дорожки, чья последняя сохранённая validation была
 * unresolved:true — вызывается из confirm-роута ТОЛЬКО для той
 * попытки/дорожки, к которой относится только что подтверждённый
 * фрагмент (см. заголовок .../recording/chunks/route.ts). Заявленный
 * manifest.chunkCount здесь НЕ используется как эталон (это и есть та
 * непроверенная величина) — источник истины сам реестр:
 *
 *   - в пределах UNRESOLVED_GRACE_MS от finishedAt — статус ещё не
 *     финализируется (возвращается unresolved:true с текущими
 *     актуальными chunkCount/lastSequence, даже если прямо сейчас
 *     последовательность и выглядит цельной — фрагменты ещё могут
 *     идти);
 *   - после grace-периода — финализируется: цельная
 *     последовательность 0..N без дыр → ok:true; дыра → ok:false,
 *     unresolved:false (это уже не вопрос задержки).
 */
export async function checkUnresolvedTrack(
  supabase: SupabaseClient,
  sessionId: string,
  attemptId: string,
  role: string,
  finishedAt: string | undefined
): Promise<TrackValidation & { chunkCount: number; lastSequence: number }> {
  const sequences = await fetchSequences(supabase, sessionId, attemptId, role);
  if ("error" in sequences) {
    return {
      role,
      ok: false,
      unresolved: true,
      reason: `Не удалось прочитать реестр фрагментов: ${sequences.error}`,
      chunkCount: 0,
      lastSequence: -1,
    };
  }

  const chunkCount = sequences.length;
  const lastSequence = chunkCount > 0 ? sequences[chunkCount - 1] : -1;

  let gapReason: string | null = null;
  for (let i = 0; i < sequences.length; i++) {
    if (sequences[i] !== i) {
      gapReason = `дыра в нумерации на позиции ${i} (sequence=${sequences[i]})`;
      break;
    }
  }

  const finishedAtMs = finishedAt ? Date.parse(finishedAt) : NaN;
  const withinGrace = Number.isFinite(finishedAtMs) ? Date.now() - finishedAtMs < UNRESOLVED_GRACE_MS : true;

  if (gapReason) {
    // Дыра — это уже не вопрос задержки, независимо от grace-периода:
    // задержка могла бы дать МЕНЬШЕ фрагментов, чем заявлено, но не
    // дыру ВНУТРИ уже полученных номеров.
    return { role, ok: false, unresolved: false, reason: gapReason, chunkCount, lastSequence };
  }

  if (chunkCount === 0 || withinGrace) {
    return {
      role,
      ok: false,
      unresolved: true,
      reason: withinGrace ? "остановка ещё не подтверждена, ждём дозагрузки" : "фрагменты ещё не подтверждены",
      chunkCount,
      lastSequence,
    };
  }

  return { role, ok: true, chunkCount, lastSequence };
}

export function computeFinalStatus(validations: TrackValidation[]): "processing" | "uploading" | "incomplete" {
  if (validations.every(v => v.ok)) return "processing";
  if (validations.every(v => v.ok || v.unresolved)) return "uploading";
  return "incomplete";
}
