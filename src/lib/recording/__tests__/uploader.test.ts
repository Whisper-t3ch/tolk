// ============================================================
// Тесты на ChunkUploader (uploader.ts) — инвариант ownership
// (28.09.2026): фрагмент подтверждается РОВНО в ту попытку, к которой
// привязан (chunkStore.claimPendingChunk), никогда в другую — даже
// если тот же браузер потом начинает совсем новую попытку записи той
// же консультации. См. заголовок uploader.ts и разбор бага 27.09 в
// claude/jitsi-pilot-test-report-27-09.md в проекте.
//
// Мок fetch раздаёт ответы по URL-суффиксу и телу запроса; storage —
// простой мок uploadToSignedUrl. fake-indexeddb — реальный буфер в
// процессе Node, каждый тест использует свой sessionId, чтобы не
// пересекаться ключами с другими тестами.
// ============================================================
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { ChunkUploader } from "../uploader";
import { getAllPendingChunks } from "../chunkStore";
import type { RecordedChunk } from "../types";
import type { createClient } from "@/lib/supabase/client";

let sessionCounter = 0;
function freshSessionId(): string {
  sessionCounter += 1;
  return `uploader-test-session-${sessionCounter}`;
}

function makeChunk(overrides: Partial<RecordedChunk> = {}): RecordedChunk {
  return {
    role: "psychologist",
    sequence: 0,
    blob: new Blob(["audio-bytes"]),
    startedAtMs: 0,
    durationMs: 20_000,
    mimeType: "audio/webm",
    size: 11,
    checksum: "sha256:cafe",
    ...overrides,
  };
}

interface MockFetchCall {
  url: string;
  body: unknown;
}

/**
 * Мок сети: attempts всегда отдаёт следующий attemptId из attemptIdQueue
 * (по умолчанию генерирует уникальный); authorize/confirm управляются
 * через authorizeHandler/confirmHandler — по умолчанию оба всегда
 * успешны. calls накапливает всё для проверок в тестах.
 */
function createMockFetch(opts: {
  authorizeHandler?: (body: any) => { status: number; json?: unknown };
  confirmHandler?: (body: any) => { status: number; json?: unknown };
} = {}) {
  const calls: MockFetchCall[] = [];
  let attemptCounter = 0;

  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, body });

    if (url.endsWith("/recording/attempts")) {
      attemptCounter += 1;
      return jsonResponse(200, { ok: true, attemptId: `attempt-${attemptCounter}` });
    }
    if (url.endsWith("/recording/chunks/authorize")) {
      const handler = opts.authorizeHandler ?? (() => ({ status: 200, json: { ok: true, alreadyConfirmed: false, path: "p", token: "t" } }));
      const result = handler(body);
      return jsonResponse(result.status, result.json ?? {});
    }
    if (url.endsWith("/recording/chunks")) {
      const handler = opts.confirmHandler ?? (() => ({ status: 200, json: { ok: true } }));
      const result = handler(body);
      return jsonResponse(result.status, result.json ?? {});
    }
    if (url.endsWith("/recording/manifest")) {
      return jsonResponse(200, { ok: true, status: "processing" });
    }
    if (url.endsWith("/recording/heartbeat")) {
      return jsonResponse(200, { ok: true });
    }
    throw new Error(`Неожиданный URL в тесте: ${url}`);
  });

  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function createMockStorage(uploadResult: { error: { message: string } | null } = { error: null }) {
  const uploadToSignedUrl = vi.fn(async () => uploadResult);
  return {
    storage: {
      from: vi.fn(() => ({ uploadToSignedUrl })),
    },
  } as unknown as ReturnType<typeof createClient> & { storage: { from: () => { uploadToSignedUrl: typeof uploadToSignedUrl } } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("ChunkUploader — привязка фрагмента к попытке (ownership)", () => {
  it("свежий фрагмент привязывается к попытке ТЕКУЩЕГО uploader'а и подтверждается под её attemptId", async () => {
    const sessionId = freshSessionId();
    const { fetchImpl, calls } = createMockFetch();
    const storage = createMockStorage();
    const uploaded = deferred<RecordedChunk>();

    const uploader = new ChunkUploader({
      sessionId,
      fetchImpl,
      storageClient: storage,
      onChunkUploaded: chunk => uploaded.resolve(chunk),
    });

    uploader.enqueue(makeChunk({ sequence: 0 }));
    await uploaded.promise;

    expect(uploader.getAttemptId()).toBe("attempt-1");
    const authorizeCall = calls.find(c => c.url.endsWith("/authorize"));
    const confirmCall = calls.find(c => c.url.endsWith("/recording/chunks") && !c.url.endsWith("/authorize"));
    expect((authorizeCall?.body as any).attemptId).toBe("attempt-1");
    expect((confirmCall?.body as any).attemptId).toBe("attempt-1");

    const pending = await getAllPendingChunks(sessionId);
    expect(pending).toHaveLength(0); // подтверждённый фрагмент убран из буфера
  });

  it("новая попытка в той же сессии: новый ChunkUploader (== перезагрузка вкладки) получает СВОЙ, другой attemptId", async () => {
    const sessionId = freshSessionId();

    const mock1 = createMockFetch();
    const uploaded1 = deferred<void>();
    const u1 = new ChunkUploader({
      sessionId,
      fetchImpl: mock1.fetchImpl,
      storageClient: createMockStorage(),
      onChunkUploaded: () => uploaded1.resolve(),
    });
    u1.enqueue(makeChunk({ sequence: 0 }));
    await uploaded1.promise;
    expect(u1.getAttemptId()).toBe("attempt-1");

    // "Перезагрузка": совсем новый ChunkUploader, своя мок-сеть со своим счётчиком attemptId.
    const mock2 = createMockFetch();
    const uploaded2 = deferred<void>();
    const u2 = new ChunkUploader({
      sessionId,
      fetchImpl: mock2.fetchImpl,
      storageClient: createMockStorage(),
      onChunkUploaded: () => uploaded2.resolve(),
    });
    u2.enqueue(makeChunk({ sequence: 0 })); // новая запись начинается с sequence 0 заново
    await uploaded2.promise;

    expect(u2.getAttemptId()).toBe("attempt-1"); // свой счётчик в mock2 — совпадение цифры не значит совпадение попытки
    expect(mock1.calls.filter(c => c.url.endsWith("/recording/attempts"))).toHaveLength(1);
    expect(mock2.calls.filter(c => c.url.endsWith("/recording/attempts"))).toHaveLength(1); // независимый POST, не переиспользование
  });

  it("дозагрузка после 'перезагрузки страницы': зависший НЕпривязанный фрагмент подхватывается НОВОЙ попыткой (это единственный корректный случай 'усыновления')", async () => {
    const sessionId = freshSessionId();
    const mock1 = createMockFetch({
      authorizeHandler: () => ({ status: 500 }), // сеть недоступна — фрагмент так и останется в IndexedDB
    });
    const u1 = new ChunkUploader({ sessionId, fetchImpl: mock1.fetchImpl, storageClient: createMockStorage() });
    u1.enqueue(makeChunk({ sequence: 0 }));
    // Ждём, пока ensureAttempt() и первая (неудачная) попытка authorize отработают —
    // не дожидаемся retry-цепочки целиком, просто даём микрозадачам пройти.
    await new Promise(r => setTimeout(r, 20));

    const pendingAfterCrash = await getAllPendingChunks(sessionId);
    expect(pendingAfterCrash).toHaveLength(1);
    expect(pendingAfterCrash[0].attemptId).toBe("attempt-1"); // уже привязан к первой попытке (claim до authorize)

    // "Перезагрузка": новый ChunkUploader, на этот раз сеть работает.
    const mock2 = createMockFetch();
    const resumed = deferred<[RecordedChunk, string]>();
    const u2 = new ChunkUploader({
      sessionId,
      fetchImpl: mock2.fetchImpl,
      storageClient: createMockStorage(),
      onForeignChunkResumed: (chunk, attemptId) => resumed.resolve([chunk, attemptId]),
    });
    await u2.flushPending();
    const [, resumedAttemptId] = await resumed.promise;

    // Ключевая проверка инварианта: догружен СТРОГО в его же ("attempt-1"
    // из первого uploader'а), а НЕ в attemptId нового uploader'а (у
    // которого своя, независимая нумерация в mock2 — тоже была бы
    // "attempt-1", но по КОНСТРУКЦИИ разных моков, а не потому что это
    // одна и та же попытка).
    expect(resumedAttemptId).toBe("attempt-1");
    const authorizeCallOnU2 = mock2.calls.find(c => c.url.endsWith("/authorize"));
    expect((authorizeCallOnU2?.body as any).attemptId).toBe("attempt-1");
    // u2 не должен был вообще создавать свою попытку ради этого чужого фрагмента.
    expect(mock2.calls.some(c => c.url.endsWith("/recording/attempts"))).toBe(false);
    expect(u2.getAttemptId()).toBeNull();

    const pendingAfterResume = await getAllPendingChunks(sessionId);
    expect(pendingAfterResume).toHaveLength(0);
  });

  it("зависший фрагмент СТАРОЙ попытки никогда не подтверждается под НОВЫМ attemptId, даже если новая попытка уже активна", async () => {
    const sessionId = freshSessionId();

    // Симулируем: фрагмент уже привязан к старой, отменённой попытке
    // (ровно как случилось 27.09 — chunk.attemptId = "attempt-OLD"), и
    // лежит в буфере непойманным.
    const { putPendingChunk, claimPendingChunk } = await import("../chunkStore");
    await putPendingChunk(sessionId, makeChunk({ sequence: 10, startedAtMs: 200_407 }));
    await claimPendingChunk(sessionId, "psychologist", 10, "attempt-OLD");

    // Новый uploader уже успел создать и использовать СВОЮ, новую попытку
    // (например, реальная новая запись уже идёт и её chunk 0 подтверждён).
    const mock = createMockFetch();
    const ownUploaded = deferred<void>();
    const u = new ChunkUploader({
      sessionId,
      fetchImpl: mock.fetchImpl,
      storageClient: createMockStorage(),
      onChunkUploaded: () => ownUploaded.resolve(),
    });
    u.enqueue(makeChunk({ sequence: 0 })); // новая, реальная запись этой попытки
    await ownUploaded.promise;
    expect(u.getAttemptId()).toBe("attempt-1");

    // Теперь flushPending (например, следующее монтирование этой же
    // вкладки) подхватывает осиротевший чужой фрагмент. onForeignChunkResumed
    // передаётся только через конструктор — отдельный uploader с колбэком,
    // тот же sessionId/буфер IndexedDB.
    const resumed = deferred<string>();
    const u2 = new ChunkUploader({
      sessionId,
      fetchImpl: mock.fetchImpl,
      storageClient: createMockStorage(),
      onForeignChunkResumed: (_chunk, attemptId) => resumed.resolve(attemptId),
    });
    await u2.flushPending();
    const foreignAttemptId = await resumed.promise;

    expect(foreignAttemptId).toBe("attempt-OLD");
    expect(foreignAttemptId).not.toBe(u.getAttemptId());
    expect(foreignAttemptId).not.toBe(u2.getAttemptId());
    const confirmCalls = mock.calls.filter(c => c.url.endsWith("/recording/chunks") && !c.url.endsWith("/authorize"));
    const confirmForSeq10 = confirmCalls.find(c => (c.body as any).sequence === 10);
    expect((confirmForSeq10?.body as any).attemptId).toBe("attempt-OLD");
  });

  it("повторная отправка (retry того же фрагмента): authorize alreadyConfirmed=true пропускает upload/confirm, но фрагмент всё равно считается выгруженным", async () => {
    const sessionId = freshSessionId();
    const mock = createMockFetch({
      authorizeHandler: () => ({ status: 200, json: { ok: true, alreadyConfirmed: true } }),
    });
    const storage = createMockStorage();
    const uploaded = deferred<void>();
    const u = new ChunkUploader({
      sessionId,
      fetchImpl: mock.fetchImpl,
      storageClient: storage,
      onChunkUploaded: () => uploaded.resolve(),
    });

    u.enqueue(makeChunk({ sequence: 3 }));
    await uploaded.promise;

    expect((storage as any).storage.from().uploadToSignedUrl).not.toHaveBeenCalled();
    expect(mock.calls.some(c => c.url.endsWith("/recording/chunks") && !c.url.endsWith("/authorize"))).toBe(false);
    const pending = await getAllPendingChunks(sessionId);
    expect(pending).toHaveLength(0);
  });
});

describe("ChunkUploader — quarantine чужого фрагмента после исчерпания retry", () => {
  // Реальные таймеры с искусственно крошечными задержками (retryDelaysMs,
  // см. ChunkUploaderOptions в uploader.ts) вместо fake-таймеров: вся
  // цепочка retry реально существующего кода проходит за миллисекунды, без
  // хрупкого взаимодействия vi.useFakeTimers() с внутренними таймерами
  // fake-indexeddb.
  const TINY_RETRY_DELAYS_MS = [1, 1, 1, 1, 1];

  it("если дозагрузка в исходную (чужую) попытку раз за разом отвергается — фрагмент уходит в quarantine и не трогается снова", async () => {
    const sessionId = freshSessionId();
    const { putPendingChunk, claimPendingChunk } = await import("../chunkStore");
    await putPendingChunk(sessionId, makeChunk({ sequence: 4 }));
    await claimPendingChunk(sessionId, "psychologist", 4, "attempt-DEAD");

    const mock = createMockFetch({
      authorizeHandler: () => ({ status: 500 }), // исходная попытка недоступна на сервере — всегда 5xx
    });
    const quarantined = deferred<[RecordedChunk, string, Error]>();
    const u = new ChunkUploader({
      sessionId,
      fetchImpl: mock.fetchImpl,
      storageClient: createMockStorage(),
      retryDelaysMs: TINY_RETRY_DELAYS_MS,
      onForeignChunkQuarantined: (chunk, attemptId, error) => quarantined.resolve([chunk, attemptId, error]),
    });

    await u.flushPending();
    const [, quarantinedAttemptId] = await quarantined.promise;

    expect(quarantinedAttemptId).toBe("attempt-DEAD");
    const pending = await getAllPendingChunks(sessionId);
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("quarantined");

    // Повторный flushPending (например, следующее монтирование) НЕ
    // должен снова долбить тот же недоступный attemptId — фрагмент
    // изолирован явно, а не молча забыт и не долбится вечно.
    const authorizeCallsBefore = mock.calls.filter(c => c.url.endsWith("/authorize")).length;
    const u2 = new ChunkUploader({
      sessionId,
      fetchImpl: mock.fetchImpl,
      storageClient: createMockStorage(),
      retryDelaysMs: TINY_RETRY_DELAYS_MS,
    });
    await u2.flushPending();
    const authorizeCallsAfter = mock.calls.filter(c => c.url.endsWith("/authorize")).length;
    expect(authorizeCallsAfter).toBe(authorizeCallsBefore);
  });

  it("give-up СВОЕГО (не чужого) фрагмента остаётся обычным pending — существующее поведение onChunkGaveUp не сломано", async () => {
    const sessionId = freshSessionId();
    const mock = createMockFetch({ authorizeHandler: () => ({ status: 500 }) });
    const gaveUp = deferred<[RecordedChunk, Error]>();
    const u = new ChunkUploader({
      sessionId,
      fetchImpl: mock.fetchImpl,
      storageClient: createMockStorage(),
      retryDelaysMs: TINY_RETRY_DELAYS_MS,
      onChunkGaveUp: (chunk, error) => gaveUp.resolve([chunk, error]),
    });

    u.enqueue(makeChunk({ sequence: 0 }));
    await gaveUp.promise;

    const pending = await getAllPendingChunks(sessionId);
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("pending"); // НЕ quarantined — это своя попытка, ретрай возможен позже
    expect(pending[0].attemptId).toBe("attempt-1");
  });
});

describe("ChunkUploader — manifest", () => {
  it("sendManifest отправляет attemptId текущего uploader'а вместе с manifest", async () => {
    const sessionId = freshSessionId();
    const mock = createMockFetch();
    const uploaded = deferred<void>();
    const u = new ChunkUploader({
      sessionId,
      fetchImpl: mock.fetchImpl,
      storageClient: createMockStorage(),
      onChunkUploaded: () => uploaded.resolve(),
    });
    u.enqueue(makeChunk({ sequence: 0 }));
    await uploaded.promise;

    const result = await u.sendManifest({
      sessionId,
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(20_000).toISOString(),
      tracks: [
        { role: "psychologist", mimeType: "audio/webm", firstSequence: 0, lastSequence: 0, chunkCount: 1, totalDurationMs: 20_000, state: "stopped" },
      ],
    });

    expect(result.ok).toBe(true);
    const manifestCall = mock.calls.find(c => c.url.endsWith("/recording/manifest"));
    expect((manifestCall?.body as any).attemptId).toBe(u.getAttemptId());
    expect((manifestCall?.body as any).attemptId).toBe("attempt-1");
  });
});
