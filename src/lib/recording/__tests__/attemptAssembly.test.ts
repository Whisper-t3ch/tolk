import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { assembleAttemptTrack, assembleSessionRecording } from "../attemptAssembly";

// ============================================================
// Этап 3.1 — тесты сборки на синтетических байтах (не настоящем
// аудио, см. честную оговорку в заголовке attemptAssembly.ts: сама
// склейка WebM-фрагментов конкатенацией подтверждена здесь только
// структурно — "правильные байты в правильном порядке", не то, что
// результат реально проигрывается как аудио).
//
// Мок Supabase-клиента ниже — тот же паттерн, что в
// .../recording/chunks/__tests__/route.test.ts: общий backend-объект
// (чанки + Storage-объекты + попытки), chainable query-builder,
// awaitable через .then().
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
}

function makeBackend(): Backend {
  return { chunks: [], storageObjects: new Map(), attempts: [] };
}

function addChunk(
  backend: Backend,
  opts: {
    sessionId: string;
    attemptId: string;
    track: string;
    sequence: number;
    content: string;
    verified?: boolean;
    checksumOverride?: string;
  }
) {
  const buffer = Buffer.from(opts.content);
  const storageKey = `${opts.sessionId}/${opts.attemptId}/${opts.track}/${String(opts.sequence).padStart(6, "0")}.webm`;
  backend.storageObjects.set(storageKey, buffer);
  backend.chunks.push({
    session_id: opts.sessionId,
    recording_attempt_id: opts.attemptId,
    track: opts.track,
    sequence: opts.sequence,
    storage_key: storageKey,
    checksum: opts.checksumOverride ?? sha(buffer),
    checksum_verified: opts.verified ?? false,
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

function makeClient(backend: Backend) {
  return {
    from(table: string) {
      if (table === "session_recording_chunks") {
        return {
          select: () => makeQuery(backend.chunks, "sequence"),
          update: (patch: Record<string, unknown>) => makeQuery(backend.chunks, "sequence").update(patch),
        };
      }
      if (table === "recording_attempts") {
        return { select: () => makeQuery(backend.attempts, "started_at") };
      }
      throw new Error(`unexpected table ${table}`);
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

const SESSION_ID = "11111111-1111-1111-1111-111111111111";

describe("assembleAttemptTrack", () => {
  it("склеивает все подтверждённые фрагменты по порядку и выставляет checksum_verified", async () => {
    const backend = makeBackend();
    const attemptId = "attempt-1";
    addChunk(backend, { sessionId: SESSION_ID, attemptId, track: "psychologist", sequence: 0, content: "AAA" });
    addChunk(backend, { sessionId: SESSION_ID, attemptId, track: "psychologist", sequence: 1, content: "BBB" });
    const client = makeClient(backend);

    const result = await assembleAttemptTrack(client, { sessionId: SESSION_ID, attemptId, track: "psychologist" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.buffer.toString()).toBe("AAABBB");
    expect(result.chunkCount).toBe(2);
    expect(result.verifiedNow).toBe(2);
    expect(backend.chunks.every(c => c.checksum_verified)).toBe(true);
  });

  it("блокирует сборку при дыре в нумерации, не скачивая лишнего", async () => {
    const backend = makeBackend();
    const attemptId = "attempt-gap";
    addChunk(backend, { sessionId: SESSION_ID, attemptId, track: "psychologist", sequence: 0, content: "AAA" });
    addChunk(backend, { sessionId: SESSION_ID, attemptId, track: "psychologist", sequence: 2, content: "CCC" });
    const client = makeClient(backend);

    const result = await assembleAttemptTrack(client, { sessionId: SESSION_ID, attemptId, track: "psychologist" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected blocked");
    expect(result.reason).toMatch(/дыра/i);
    expect(result.blockedAtSequence).toBe(1);
  });

  it("блокирует сборку при несовпадении checksum и не выставляет checksum_verified", async () => {
    const backend = makeBackend();
    const attemptId = "attempt-bad-checksum";
    addChunk(backend, {
      sessionId: SESSION_ID,
      attemptId,
      track: "psychologist",
      sequence: 0,
      content: "AAA",
      checksumOverride: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    });
    const client = makeClient(backend);

    const result = await assembleAttemptTrack(client, { sessionId: SESSION_ID, attemptId, track: "psychologist" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected blocked");
    expect(result.reason).toMatch(/контрольная сумма/i);
    expect(backend.chunks[0].checksum_verified).toBe(false);
  });

  it("доверяет уже сверенным фрагментам и не пересчитывает их checksum заново", async () => {
    const backend = makeBackend();
    const attemptId = "attempt-trusted";
    // checksum заведомо не совпадает с реальным содержимым, но
    // checksum_verified уже true — функция обязана доверять этому и
    // не блокировать сборку повторной сверкой.
    addChunk(backend, {
      sessionId: SESSION_ID,
      attemptId,
      track: "psychologist",
      sequence: 0,
      content: "AAA",
      checksumOverride: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      verified: true,
    });
    const client = makeClient(backend);

    const result = await assembleAttemptTrack(client, { sessionId: SESSION_ID, attemptId, track: "psychologist" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.verifiedNow).toBe(0);
    expect(result.buffer.toString()).toBe("AAA");
  });

  it("сообщает empty:true, если дорожка вообще не записывалась в этой попытке", async () => {
    const backend = makeBackend();
    const client = makeClient(backend);
    const result = await assembleAttemptTrack(client, { sessionId: SESSION_ID, attemptId: "attempt-empty", track: "client" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected blocked");
    expect(result.empty).toBe(true);
  });
});

describe("assembleSessionRecording", () => {
  it("склеивает несколько попыток (reload/retry) в хронологическом порядке", async () => {
    const backend = makeBackend();
    backend.attempts.push(
      { id: "attempt-1", session_id: SESSION_ID, status: "superseded", started_at: "2026-10-02T10:00:00Z" },
      { id: "attempt-2", session_id: SESSION_ID, status: "completed", started_at: "2026-10-02T10:05:00Z" }
    );
    addChunk(backend, { sessionId: SESSION_ID, attemptId: "attempt-1", track: "psychologist", sequence: 0, content: "A1" });
    addChunk(backend, { sessionId: SESSION_ID, attemptId: "attempt-1", track: "psychologist", sequence: 1, content: "A2" });
    addChunk(backend, { sessionId: SESSION_ID, attemptId: "attempt-2", track: "psychologist", sequence: 0, content: "B1" });
    addChunk(backend, { sessionId: SESSION_ID, attemptId: "attempt-2", track: "psychologist", sequence: 1, content: "B2" });
    const client = makeClient(backend);

    const result = await assembleSessionRecording(client, SESSION_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.attemptsUsed).toEqual(["attempt-1", "attempt-2"]);
    expect(result.tracks.psychologist?.buffer.toString()).toBe("A1A2B1B2");
    expect(result.tracks.psychologist?.totalChunks).toBe(4);
    expect(result.tracks.client).toBeUndefined();
  });

  it("блокирует сборку сессии целиком, если есть незавершённая (active) попытка", async () => {
    const backend = makeBackend();
    backend.attempts.push(
      { id: "attempt-1", session_id: SESSION_ID, status: "completed", started_at: "2026-10-02T10:00:00Z" },
      { id: "attempt-2", session_id: SESSION_ID, status: "active", started_at: "2026-10-02T10:05:00Z" }
    );
    addChunk(backend, { sessionId: SESSION_ID, attemptId: "attempt-1", track: "psychologist", sequence: 0, content: "A1" });
    const client = makeClient(backend);

    const result = await assembleSessionRecording(client, SESSION_ID);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected blocked");
    expect(result.reason).toMatch(/active/i);
    expect(result.attemptId).toBe("attempt-2");
  });

  it("блокирует сборку сессии целиком, если хотя бы одна попытка невалидна на любой дорожке", async () => {
    const backend = makeBackend();
    backend.attempts.push(
      { id: "attempt-1", session_id: SESSION_ID, status: "completed", started_at: "2026-10-02T10:00:00Z" }
    );
    addChunk(backend, { sessionId: SESSION_ID, attemptId: "attempt-1", track: "psychologist", sequence: 0, content: "A1" });
    // Дыра на дорожке client: sequence 0 пропущен.
    addChunk(backend, { sessionId: SESSION_ID, attemptId: "attempt-1", track: "client", sequence: 1, content: "C2" });
    const client = makeClient(backend);

    const result = await assembleSessionRecording(client, SESSION_ID);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected blocked");
    expect(result.reason).toMatch(/client/);
    expect(result.attemptId).toBe("attempt-1");
  });
});
