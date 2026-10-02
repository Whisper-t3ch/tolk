import { describe, it, expect, vi } from "vitest";
import { createHash } from "crypto";
import { enqueueTranscriptionJob, claimNextJob, processNextRecordingJob, type RecordingJobRow, type JobOutcome } from "../jobQueue";
import type { SessionAssemblyOk } from "../attemptAssembly";

// ============================================================
// Этап 3.4 — тесты механики очереди (claim/enqueue/process) поверх
// мока, воспроизводящего поведение claim_recording_job() из
// migration_041_recording_jobs.sql (FOR UPDATE SKIP LOCKED + stale
// reclaim) и той же backend-модели session_recording_chunks/
// recording_attempts/Storage, что в attemptAssembly.test.ts — т.к.
// processNextRecordingJob вызывает assembleSessionRecording внутри.
// ============================================================

function sha(buffer: Buffer): string {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

interface ChunkRow {
  session_id: string;
  recording_attempt_id: string;
  track: string;
  sequence: number;
  storage_key: string;
  checksum: string;
  checksum_verified: boolean;
  size_bytes: number;
}
interface AttemptRow {
  id: string;
  session_id: string;
  status: string;
  started_at: string;
}

interface Backend {
  chunks: ChunkRow[];
  storageObjects: Map<string, Buffer>;
  attempts: AttemptRow[];
  jobs: RecordingJobRow[];
  jobSeq: number;
}

function makeBackend(): Backend {
  return { chunks: [], storageObjects: new Map(), attempts: [], jobs: [], jobSeq: 0 };
}

function addChunk(backend: Backend, opts: { sessionId: string; attemptId: string; track: string; sequence: number; content: string }) {
  const buffer = Buffer.from(opts.content);
  const storageKey = `${opts.sessionId}/${opts.attemptId}/${opts.track}/${String(opts.sequence).padStart(6, "0")}.webm`;
  backend.storageObjects.set(storageKey, buffer);
  backend.chunks.push({
    session_id: opts.sessionId,
    recording_attempt_id: opts.attemptId,
    track: opts.track,
    sequence: opts.sequence,
    storage_key: storageKey,
    checksum: sha(buffer),
    checksum_verified: false,
    size_bytes: buffer.length,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeQuery(rows: any[], sortKey: string) {
  const filters: Array<[string, unknown]> = [];
  let mode: "select" | "update" = "select";
  let patch: Record<string, unknown> = {};
  const builder = {
    eq(key: string, value: unknown) {
      filters.push([key, value]);
      return builder;
    },
    order() {
      return builder;
    },
    update(p: Record<string, unknown>) {
      mode = "update";
      patch = p;
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(resolve: (v: { data: any[] | null; error: { message: string } | null }) => void) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const matches = rows.filter((r: any) => filters.every(([k, v]) => r[k] === v));
      if (mode === "update") {
        matches.forEach((m: any) => Object.assign(m, patch));
        resolve({ data: null, error: null });
        return;
      }
      const sorted = [...matches].sort((a: any, b: any) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0));
      resolve({ data: sorted, error: null });
    },
  };
  return builder;
}

function makeJobsTable(backend: Backend) {
  return {
    insert(obj: { session_id: string; job_type: string }) {
      const dup = backend.jobs.find(j => j.session_id === obj.session_id && j.job_type === obj.job_type);
      return {
        select() {
          return {
            async maybeSingle() {
              if (dup) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
              backend.jobSeq += 1;
              const row: RecordingJobRow = {
                id: `job-${backend.jobSeq}`,
                session_id: obj.session_id,
                job_type: obj.job_type,
                status: "pending",
                attempts_count: 0,
                locked_at: null,
                locked_by: null,
                last_error: null,
                result: null,
                created_at: new Date(Date.now() + backend.jobSeq).toISOString(),
                updated_at: new Date().toISOString(),
              };
              backend.jobs.push(row);
              return { data: { id: row.id }, error: null };
            },
          };
        },
      };
    },
    update(patch: Record<string, unknown>) {
      const filters: Array<[string, unknown]> = [];
      const builder = {
        eq(key: string, value: unknown) {
          filters.push([key, value]);
          return builder;
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        then(resolve: (v: { error: null }) => void) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const matches = backend.jobs.filter((j: any) => filters.every(([k, v]) => j[k] === v));
          matches.forEach(j => Object.assign(j, patch));
          resolve({ error: null });
        },
      };
      return builder;
    },
  };
}

function claimMock(backend: Backend, args: { p_locked_by: string; p_stale_after_seconds: number }) {
  const now = Date.now();
  const candidates = backend.jobs.filter(j => {
    if (j.status === "pending") return true;
    if (j.status === "processing" && j.locked_at) {
      return now - Date.parse(j.locked_at) > args.p_stale_after_seconds * 1000;
    }
    return false;
  });
  const sorted = [...candidates].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const job = sorted[0];
  if (!job) return { data: [], error: null };
  job.status = "processing";
  job.locked_at = new Date().toISOString();
  job.locked_by = args.p_locked_by;
  job.attempts_count += 1;
  job.updated_at = new Date().toISOString();
  return { data: [{ ...job }], error: null };
}

function makeClient(backend: Backend) {
  return {
    from(table: string) {
      if (table === "session_recording_chunks") {
        return { select: () => makeQuery(backend.chunks, "sequence"), update: (p: Record<string, unknown>) => makeQuery(backend.chunks, "sequence").update(p) };
      }
      if (table === "recording_attempts") {
        return { select: () => makeQuery(backend.attempts, "started_at") };
      }
      if (table === "recording_jobs") {
        return makeJobsTable(backend);
      }
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(fn: string, args: { p_locked_by: string; p_stale_after_seconds: number }) {
      if (fn !== "claim_recording_job") throw new Error(`unexpected rpc ${fn}`);
      return claimMock(backend, args);
    },
    storage: {
      from(_bucket: string) {
        return {
          async download(key: string) {
            const buf = backend.storageObjects.get(key);
            if (!buf) return { data: null, error: { message: "объект не найден" } };
            const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            return { data: { arrayBuffer: async () => arrayBuffer }, error: null };
          },
        };
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const SESSION_ID = "22222222-2222-2222-2222-222222222222";

describe("enqueueTranscriptionJob", () => {
  it("идемпотентна — повторная постановка для той же сессии не создаёт вторую задачу", async () => {
    const backend = makeBackend();
    const client = makeClient(backend);

    const first = await enqueueTranscriptionJob(client, SESSION_ID);
    const second = await enqueueTranscriptionJob(client, SESSION_ID);

    expect(first).toEqual({ ok: true, created: true });
    expect(second).toEqual({ ok: true, created: false });
    expect(backend.jobs).toHaveLength(1);
  });
});

describe("claimNextJob", () => {
  it("возвращает null, если очередь пуста", async () => {
    const backend = makeBackend();
    const client = makeClient(backend);
    const job = await claimNextJob(client, "worker-1");
    expect(job).toBeNull();
  });

  it("claim-ит pending задачу и выставляет processing/locked_by", async () => {
    const backend = makeBackend();
    const client = makeClient(backend);
    await enqueueTranscriptionJob(client, SESSION_ID);

    const job = await claimNextJob(client, "worker-1");

    expect(job?.status).toBe("processing");
    expect(job?.locked_by).toBe("worker-1");
    expect(job?.attempts_count).toBe(1);
  });

  it("не трогает свежую processing-задачу другого воркера (не зависшую)", async () => {
    const backend = makeBackend();
    const client = makeClient(backend);
    await enqueueTranscriptionJob(client, SESSION_ID);
    await claimNextJob(client, "worker-1");

    const second = await claimNextJob(client, "worker-2", 600);
    expect(second).toBeNull();
  });

  it("повторно claim-ит зависшую processing-задачу после stale-таймаута", async () => {
    const backend = makeBackend();
    const client = makeClient(backend);
    await enqueueTranscriptionJob(client, SESSION_ID);
    await claimNextJob(client, "worker-1", 600);
    // Искусственно "состариваем" locked_at — воркер упал 20 минут назад.
    backend.jobs[0].locked_at = new Date(Date.now() - 20 * 60 * 1000).toISOString();

    const reclaimed = await claimNextJob(client, "worker-2", 600);
    expect(reclaimed?.locked_by).toBe("worker-2");
    expect(reclaimed?.attempts_count).toBe(2);
  });
});

describe("processNextRecordingJob", () => {
  it("возвращает null, если очередь пуста", async () => {
    const backend = makeBackend();
    const client = makeClient(backend);
    const result = await processNextRecordingJob(client, "worker-1", async () => ({ kind: "completed" }));
    expect(result).toBeNull();
  });

  it("happy path: сборка ок → transcribe() вызван → статус completed", async () => {
    const backend = makeBackend();
    backend.attempts.push({ id: "attempt-1", session_id: SESSION_ID, status: "completed", started_at: "2026-10-02T10:00:00Z" });
    addChunk(backend, { sessionId: SESSION_ID, attemptId: "attempt-1", track: "psychologist", sequence: 0, content: "AAA" });
    const client = makeClient(backend);
    await enqueueTranscriptionJob(client, SESSION_ID);

    const transcribe = vi.fn(async (assembly: SessionAssemblyOk): Promise<JobOutcome> => {
      expect(assembly.tracks.psychologist?.buffer.toString()).toBe("AAA");
      return { kind: "completed", result: { ok: true } };
    });

    const result = await processNextRecordingJob(client, "worker-1", transcribe);

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(result?.outcome.kind).toBe("completed");
    expect(backend.jobs[0].status).toBe("completed");
    expect(backend.jobs[0].result).toEqual({ ok: true });
  });

  it("transient-блокировка сборки (активная попытка) → requeued в pending, transcribe() НЕ вызывается", async () => {
    const backend = makeBackend();
    backend.attempts.push(
      { id: "attempt-1", session_id: SESSION_ID, status: "completed", started_at: "2026-10-02T10:00:00Z" },
      { id: "attempt-2", session_id: SESSION_ID, status: "active", started_at: "2026-10-02T10:05:00Z" }
    );
    addChunk(backend, { sessionId: SESSION_ID, attemptId: "attempt-1", track: "psychologist", sequence: 0, content: "AAA" });
    const client = makeClient(backend);
    await enqueueTranscriptionJob(client, SESSION_ID);

    const transcribe = vi.fn(async (): Promise<JobOutcome> => ({ kind: "completed" }));
    const result = await processNextRecordingJob(client, "worker-1", transcribe);

    expect(transcribe).not.toHaveBeenCalled();
    expect(result?.outcome.kind).toBe("requeued");
    expect(backend.jobs[0].status).toBe("pending");
    expect(backend.jobs[0].locked_by).toBeNull();
  });

  it("доказанно невалидная сборка (дыра) → failed, transcribe() НЕ вызывается", async () => {
    const backend = makeBackend();
    backend.attempts.push({ id: "attempt-1", session_id: SESSION_ID, status: "completed", started_at: "2026-10-02T10:00:00Z" });
    addChunk(backend, { sessionId: SESSION_ID, attemptId: "attempt-1", track: "psychologist", sequence: 0, content: "AAA" });
    addChunk(backend, { sessionId: SESSION_ID, attemptId: "attempt-1", track: "psychologist", sequence: 2, content: "CCC" });
    const client = makeClient(backend);
    await enqueueTranscriptionJob(client, SESSION_ID);

    const transcribe = vi.fn(async (): Promise<JobOutcome> => ({ kind: "completed" }));
    const result = await processNextRecordingJob(client, "worker-1", transcribe);

    expect(transcribe).not.toHaveBeenCalled();
    expect(result?.outcome.kind).toBe("failed");
    expect(backend.jobs[0].status).toBe("failed");
    expect(backend.jobs[0].last_error).toMatch(/дыра/i);
  });

  it("сборка ок, но transcribe() сообщает blocked (например ASR не настроен) → статус blocked", async () => {
    const backend = makeBackend();
    backend.attempts.push({ id: "attempt-1", session_id: SESSION_ID, status: "completed", started_at: "2026-10-02T10:00:00Z" });
    addChunk(backend, { sessionId: SESSION_ID, attemptId: "attempt-1", track: "psychologist", sequence: 0, content: "AAA" });
    const client = makeClient(backend);
    await enqueueTranscriptionJob(client, SESSION_ID);

    const transcribe = vi.fn(async (): Promise<JobOutcome> => ({ kind: "blocked", reason: "ASR не настроен" }));
    const result = await processNextRecordingJob(client, "worker-1", transcribe);

    expect(result?.outcome).toEqual({ kind: "blocked", reason: "ASR не настроен" });
    expect(backend.jobs[0].status).toBe("blocked");
    expect(backend.jobs[0].last_error).toBe("ASR не настроен");
  });
});
