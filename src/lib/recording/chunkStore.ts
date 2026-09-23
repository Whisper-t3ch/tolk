// ============================================================
// IndexedDB-буфер невыгруженных фрагментов записи (Этап 2).
//
// Зачем отдельный буфер, а не просто "попробовать fetch и забыть при
// неудаче": сеть на этапе выгрузки — самое ненадёжное звено всей
// архитектуры (см. claude/browser-recording-architecture-spec.md,
// таблица "Работа при сбоях"). Если фрагмент только в памяти вкладки и
// upload не удался, единственный шанс его сохранить — повторить
// попытку до того, как вкладка закроется. IndexedDB переживает
// временную потерю сети внутри одной вкладки: фрагмент кладётся сюда
// СРАЗУ при получении из MediaRecorder, ещё до первой попытки upload,
// и удаляется только по подтверждению backend.
//
// ЧЕСТНО про границы: это НЕ полное решение "resume после перезагрузки
// страницы" из архитектурного документа. JitsiCallView сейчас не умеет
// переподключаться к уже идущей записи при повторном монтировании —
// если психолог перезагрузит вкладку посреди консультации, новый
// SessionRecorder начнётся с нуля, а несданные фрагменты из ПРЕЖНЕГО
// монтирования останутся в IndexedDB осиротевшими (не потеряны с диска,
// но и не будут автоматически дозагружены). Восстановление именно
// этого сценария — отдельная задача, не входящая в объём Этапа 2.
// Буфер здесь защищает от куда более частого случая: кратковременный
// обрыв сети/Wi-Fi без перезагрузки вкладки, ретраи в рамках уже
// открытой страницы.
// ============================================================

import type { RecordedChunk, TrackRole } from "./types";

const DB_NAME = "tolk-recording-buffer";
const DB_VERSION = 1;
const STORE_NAME = "pending_chunks";

/** То же, что RecordedChunk, но с привязкой к сессии — ключ буфера уникален по всем трём полям. */
export interface PendingChunk extends RecordedChunk {
  sessionId: string;
}

function chunkKey(sessionId: string, role: TrackRole, sequence: number): string {
  return `${sessionId}:${role}:${sequence}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB недоступен"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("bySession", "sessionId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Не удалось открыть IndexedDB"));
  });
}

/** Кладёт фрагмент в буфер. Вызывать сразу при получении из MediaRecorder, до первой попытки upload. */
export async function putPendingChunk(sessionId: string, chunk: RecordedChunk): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({
        key: chunkKey(sessionId, chunk.role, chunk.sequence),
        sessionId,
        ...chunk,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Буфер — сеть безопасности, а не единственный путь данных: если
    // IndexedDB недоступен (приватный режим Safari и т.п.), фрагмент
    // всё равно попробует уйти на backend напрямую из uploader.ts,
    // просто без защиты от потери при обрыве сети.
  }
}

/** Удаляет фрагмент из буфера после подтверждённой backend'ом выгрузки. */
export async function deletePendingChunk(sessionId: string, role: TrackRole, sequence: number): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(chunkKey(sessionId, role, sequence));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Не смогли удалить — при следующем flushPending() попытаемся
    // выгрузить повторно; backend идемпотентен (upsert по sequence),
    // лишняя попытка безопасна.
  }
}

/** Все ещё не подтверждённые фрагменты этой сессии — для ретрая при старте/восстановлении сети. */
export async function getAllPendingChunks(sessionId: string): Promise<PendingChunk[]> {
  try {
    const db = await openDb();
    const result = await new Promise<PendingChunk[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const index = tx.objectStore(STORE_NAME).index("bySession");
      const request = index.getAll(sessionId);
      request.onsuccess = () => resolve(request.result as PendingChunk[]);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result.sort((a, b) => (a.role === b.role ? a.sequence - b.sequence : a.role.localeCompare(b.role)));
  } catch {
    return [];
  }
}
