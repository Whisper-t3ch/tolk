// ============================================================
// Тесты на IndexedDB-буфер (chunkStore.ts) — в первую очередь на
// инвариант ownership, добавленный 28.09.2026 (см. заголовок
// chunkStore.ts и claude/jitsi-pilot-test-report-27-09.md в проекте):
// PendingChunk хранит attemptId явно (null, пока не привязан ни к
// одной попытке), и это единственный источник истины о том, какой
// попытке фрагмент принадлежит.
//
// Использует fake-indexeddb (полифилл в процессе Node, без браузера) —
// каждый тест берёт свой sessionId, чтобы не пересекаться ключами
// (`sessionId:role:sequence`) с другими тестами в том же процессе.
// ============================================================
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  putPendingChunk,
  claimPendingChunk,
  quarantinePendingChunk,
  deletePendingChunk,
  getAllPendingChunks,
  type PendingChunk,
} from "../chunkStore";
import type { RecordedChunk } from "../types";

let sessionCounter = 0;
function freshSessionId(): string {
  sessionCounter += 1;
  return `test-session-${sessionCounter}`;
}

function makeChunk(overrides: Partial<RecordedChunk> = {}): RecordedChunk {
  return {
    role: "psychologist",
    sequence: 0,
    blob: new Blob(["x"]),
    startedAtMs: 0,
    durationMs: 20_000,
    mimeType: "audio/webm",
    size: 1,
    checksum: "sha256:deadbeef",
    ...overrides,
  };
}

describe("chunkStore — привязка к попытке (ownership)", () => {
  it("putPendingChunk кладёт фрагмент с attemptId: null (ещё ничей)", async () => {
    const sessionId = freshSessionId();
    await putPendingChunk(sessionId, makeChunk());

    const pending = await getAllPendingChunks(sessionId);
    expect(pending).toHaveLength(1);
    expect(pending[0].attemptId).toBeNull();
    expect(pending[0].status).toBe("pending");
  });

  it("claimPendingChunk привязывает фрагмент к попытке — и это видно в getAllPendingChunks", async () => {
    const sessionId = freshSessionId();
    await putPendingChunk(sessionId, makeChunk({ sequence: 5 }));
    await claimPendingChunk(sessionId, "psychologist", 5, "attempt-A");

    const pending = await getAllPendingChunks(sessionId);
    expect(pending).toHaveLength(1);
    expect(pending[0].attemptId).toBe("attempt-A");
  });

  it("claimPendingChunk на уже удалённый фрагмент — no-op, не создаёт фантомную запись", async () => {
    const sessionId = freshSessionId();
    // Фрагмент никогда не клался в буфер (например, конкурентный путь
    // успел подтвердить и удалить его первым) — claim не должен ничего
    // создать из ничего.
    await claimPendingChunk(sessionId, "psychologist", 9, "attempt-B");
    const pending = await getAllPendingChunks(sessionId);
    expect(pending).toHaveLength(0);
  });

  it("quarantinePendingChunk помечает фрагмент, не удаляя его — данные не теряются молча", async () => {
    const sessionId = freshSessionId();
    await putPendingChunk(sessionId, makeChunk({ sequence: 2 }));
    await claimPendingChunk(sessionId, "psychologist", 2, "attempt-OLD");
    await quarantinePendingChunk(sessionId, "psychologist", 2, "не удалось дозагрузить");

    const pending = await getAllPendingChunks(sessionId);
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("quarantined");
    expect(pending[0].attemptId).toBe("attempt-OLD"); // привязка к исходной попытке сохраняется
    expect(pending[0].quarantineReason).toContain("не удалось дозагрузить");
    expect(typeof pending[0].quarantinedAt).toBe("number");
  });

  it("deletePendingChunk убирает фрагмент из буфера (подтверждённая выгрузка)", async () => {
    const sessionId = freshSessionId();
    await putPendingChunk(sessionId, makeChunk({ sequence: 1 }));
    await deletePendingChunk(sessionId, "psychologist", 1);
    const pending = await getAllPendingChunks(sessionId);
    expect(pending).toHaveLength(0);
  });

  it("legacy-запись без поля attemptId вообще нормализуется к null при чтении", async () => {
    // Симулируем запись, сделанную СТАРЫМ кодом (до 28.09.2026), у
    // которого PendingChunk вообще не имел поля attemptId — пишем
    // напрямую в ту же IndexedDB-структуру, минуя putPendingChunk.
    const sessionId = freshSessionId();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("tolk-recording-buffer", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("pending_chunks", "readwrite");
      tx.objectStore("pending_chunks").put({
        key: `${sessionId}:psychologist:7`,
        sessionId,
        role: "psychologist",
        sequence: 7,
        blob: new Blob(["legacy"]),
        startedAtMs: 140_000,
        durationMs: 20_000,
        mimeType: "audio/webm",
        size: 6,
        checksum: "sha256:legacy",
        // НЕТ поля attemptId и status — именно так выглядела запись до правки.
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    const pending: PendingChunk[] = await getAllPendingChunks(sessionId);
    expect(pending).toHaveLength(1);
    expect(pending[0].attemptId).toBeNull(); // undefined -> null, никогда "протекающий" undefined наружу
  });

  it("getAllPendingChunks сортирует по role, затем sequence", async () => {
    const sessionId = freshSessionId();
    await putPendingChunk(sessionId, makeChunk({ role: "client", sequence: 2 }));
    await putPendingChunk(sessionId, makeChunk({ role: "client", sequence: 0 }));
    await putPendingChunk(sessionId, makeChunk({ role: "psychologist", sequence: 1 }));

    const pending = await getAllPendingChunks(sessionId);
    expect(pending.map(c => `${c.role}:${c.sequence}`)).toEqual(["client:0", "client:2", "psychologist:1"]);
  });
});
