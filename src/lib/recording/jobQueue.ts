// ============================================================
// Этап 3.4 (02.10.2026): идемпотентная очередь задач на транскрипцию
// записанной сессии + обработка claimed-задачи.
//
// Модель без выделенного воркер-процесса (нет своей ВМ под него, см.
// production-rollout-runbook.md) — Vercel Cron периодически бьёт
// /api/jobs/process, роут claim-ит ОДНУ задачу (см. claimNextJob,
// делегирует в Postgres-функцию claim_recording_job —
// migration_041_recording_jobs.sql, FOR UPDATE SKIP LOCKED) и
// полностью обрабатывает её в рамках того же HTTP-вызова.
//
// Server-only, как и attemptAssembly.ts/manifestValidation.ts:
// принимает готовый SupabaseClient (service-role — очередь не имеет
// RLS-политик для authenticated, см. заголовок миграции), сам его не
// создаёт.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleSessionRecording, type SessionAssemblyOk } from "./attemptAssembly";

export const JOB_TYPE_TRANSCRIBE = "transcribe" as const;

export interface RecordingJobRow {
  id: string;
  session_id: string;
  job_type: string;
  status: "pending" | "processing" | "completed" | "failed" | "blocked";
  attempts_count: number;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** Результат injected transcribe() — то, что реально делает Этап 3.5 (GigaAM), здесь — абстрактная зависимость. */
export type JobOutcome =
  | { kind: "completed"; result?: Record<string, unknown> }
  | { kind: "blocked"; reason: string; result?: Record<string, unknown> }
  | { kind: "failed"; reason: string };

/** Результат processNextRecordingJob — надмножество JobOutcome: 'requeued' бывает ТОЛЬКО на уровне сборки (transient-блокировка), transcribe() сама никогда не requeue-ит. */
export type ProcessOutcome = JobOutcome | { kind: "requeued"; reason: string };

function isDuplicateKeyError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "23505" || /duplicate key|unique constraint/i.test(error.message ?? "");
}

/**
 * Идемпотентная постановка задачи на транскрипцию сессии. Безопасно
 * вызывать повторно для той же сессии (например, manifest-роут может
 * пересчитать finalStatus==='processing' больше одного раза при
 * позднем confirm дозагрузки) — уникальный ключ (session_id, job_type)
 * не даёт создать вторую строку; конфликт по этому ключу трактуется
 * как успех (created:false), не как ошибка.
 */
export async function enqueueTranscriptionJob(
  supabase: SupabaseClient,
  sessionId: string
): Promise<{ ok: true; created: boolean } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("recording_jobs")
    .insert({ session_id: sessionId, job_type: JOB_TYPE_TRANSCRIBE })
    .select("id")
    .maybeSingle();
  if (error) {
    if (isDuplicateKeyError(error)) return { ok: true, created: false };
    return { ok: false, error: error.message };
  }
  return { ok: true, created: Boolean(data) };
}

/**
 * Атомарный claim одной задачи — см. заголовок файла и
 * claim_recording_job() в migration_041_recording_jobs.sql. null,
 * если очередь пуста (нет pending и нет зависших processing) — это
 * нормальный, не ошибочный исход.
 */
export async function claimNextJob(
  supabase: SupabaseClient,
  workerId: string,
  staleAfterSeconds = 600
): Promise<RecordingJobRow | null> {
  const { data, error } = await supabase.rpc("claim_recording_job", {
    p_locked_by: workerId,
    p_stale_after_seconds: staleAfterSeconds,
  });
  if (error) throw new Error(`claim_recording_job: ${error.message}`);
  const rows = (data ?? []) as RecordingJobRow[];
  return rows[0] ?? null;
}

async function setJobStatus(supabase: SupabaseClient, jobId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from("recording_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) throw new Error(`не удалось обновить recording_jobs(${jobId}): ${error.message}`);
}

/**
 * Обрабатывает РОВНО ОДНУ claimed задачу целиком:
 *   1. claimNextJob — если очередь пуста, возвращает null (не ошибка).
 *   2. assembleSessionRecording (attemptAssembly.ts) — реальная сборка
 *      и checksum-сверка всех попыток сессии.
 *   3. Если сборка transient-блокирована (см. SessionAssemblyBlocked.
 *      transient — сейчас это только "есть активная попытка") —
 *      задача возвращается в 'pending' (requeued), НЕ в 'failed': это
 *      не сбой, просто рано.
 *   4. Если сборка доказанно невалидна (дыра/checksum) — 'failed',
 *      last_error = причина. Не requeue — само не исчезнет.
 *   5. Если сборка успешна — вызывается injected transcribe(assembly,
 *      job) — ЭТО единственная точка, где будущий Этап 3.5 (реальный
 *      GigaAM) подключается; здесь её нет, вызывающий роут передаёт
 *      свою реализацию (на 02.10 — заглушка, см. /api/jobs/process).
 *      Результат transcribe() маппится напрямую в статус задачи.
 */
export async function processNextRecordingJob(
  supabase: SupabaseClient,
  workerId: string,
  transcribe: (assembly: SessionAssemblyOk, job: RecordingJobRow) => Promise<JobOutcome>
): Promise<{ jobId: string; outcome: ProcessOutcome } | null> {
  const job = await claimNextJob(supabase, workerId);
  if (!job) return null;

  const assembly = await assembleSessionRecording(supabase, job.session_id);
  if (!assembly.ok) {
    if (assembly.transient) {
      await setJobStatus(supabase, job.id, { status: "pending", locked_at: null, locked_by: null, last_error: assembly.reason });
      return { jobId: job.id, outcome: { kind: "requeued", reason: assembly.reason } };
    }
    await setJobStatus(supabase, job.id, { status: "failed", last_error: assembly.reason });
    return { jobId: job.id, outcome: { kind: "failed", reason: assembly.reason } };
  }

  const outcome = await transcribe(assembly, job);
  if (outcome.kind === "completed") {
    await setJobStatus(supabase, job.id, { status: "completed", result: outcome.result ?? null, last_error: null });
  } else if (outcome.kind === "blocked") {
    await setJobStatus(supabase, job.id, { status: "blocked", result: outcome.result ?? null, last_error: outcome.reason });
  } else {
    await setJobStatus(supabase, job.id, { status: "failed", last_error: outcome.reason });
  }
  return { jobId: job.id, outcome };
}
