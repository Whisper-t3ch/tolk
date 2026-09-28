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
// но и не будут автоматически дозагружены В СВОЁ МОНТИРОВАНИЕ —
// см. ниже про attemptId: они дозагружаются, но строго в СВОЮ, а не в
// новую попытку).
//
// ============================================================
// ИНВАРИАНТ ownership (добавлено 28.09.2026, см.
// claude/jitsi-pilot-test-report-27-09.md в проекте — живой тест
// 27.09.2026 обнаружил, что 3 фрагмента психолога от ОТМЕНЁННОЙ
// попытки записи `2e2e3c15` тихо подтвердились под НОВЫМ attemptId
// `9c319a3e`, потому что flushPending() (uploader.ts) раньше запрашивал
// СВЕЖИЙ attemptId у ТЕКУЩЕГО ChunkUploader для ЛЮБОГО зависшего в
// IndexedDB фрагмента этой sessionId, не спрашивая, какой попытке он
// принадлежал на самом деле — PendingChunk вообще не хранил attemptId).
//
// Теперь каждый PendingChunk несёт `attemptId: string | null`:
//   - null — фрагмент НИ РАЗУ не был "усыновлён" ни одной попыткой
//     (ещё ни разу не пытались его выгрузить дальше локального буфера,
//     см. ChunkUploader.claimAndUpload() в uploader.ts). Только в этом
//     состоянии можно безопасно привязать его к ЛЮБОЙ попытке, в т.ч.
//     новой — потому что он никогда не был подтверждён ни под каким
//     attempt_id, коллизии не существует.
//   - конкретный id — фрагмент уже привязан к ЭТОЙ попытке
//     (claimPendingChunk() вызывается ДО authorize/confirm, см.
//     uploader.ts) и может дальше выгружаться СТРОГО под этим же
//     attemptId, сколько бы раз ни перезапускался ChunkUploader —
//     см. ChunkUploader.flushPending(): для таких фрагментов НИКОГДА
//     не подставляется attemptId текущего (нового) uploader'а.
//
// `status: "quarantined"` — отдельная попытка дозагрузить фрагмент В
// ЕГО ЖЕ исходную попытку сама исчерпала все повторы (например, та
// попытка уже давно неактивна на сервере и он её отверг, см.
// giveUp() в uploader.ts). Фрагмент НЕ удаляется (данные не выкидываем
// молча) и не подхватывается на следующих flushPending() — это и есть
// "явная изоляция с диагностическим статусом", а не тихое смешение с
// какой-то другой попыткой.
//
// Пре-миграционные (legacy) записи, сделанные ДО этой правки, физически
// не могут иметь поле attemptId вообще (undefined, а не null) — старый
// код никогда не писал его в IndexedDB. Такая запись нормализуется к
// null при чтении (см. getAllPendingChunks): это корректно, потому что
// старый код тоже удалял запись из буфера СРАЗУ по успешному confirm
// (см. deletePendingChunk) — если запись всё ещё лежит в буфере, старый
// код так и не подтвердил её ни под каким attempt_id, значит она
// действительно ничья, и "усыновление" текущей попыткой для неё так же
// безопасно, как и для honestly-null записи, сделанной уже новым кодом.
// ============================================================

import type { RecordedChunk, TrackRole } from "./types";

const DB_NAME = "tolk-recording-buffer";
const DB_VERSION = 1;
const STORE_NAME = "pending_chunks";

/** То же, что RecordedChunk, но с привязкой к сессии — ключ буфера уникален по всем трём полям. */
export interface PendingChunk extends RecordedChunk {
  sessionId: string;
  /**
   * recording_attempt_id, которой этот фрагмент уже подтверждённо
   * принадлежит — null, пока claimPendingChunk() ни разу не была
   * вызвана для него (см. заголовок файла и ChunkUploader.claimAndUpload()
   * в uploader.ts). Никогда не переписывается на ДРУГОЙ attemptId после
   * первой привязки.
   */
  attemptId: string | null;
  /**
   * "quarantined" — попытки дозагрузить фрагмент в его СОБСТВЕННУЮ
   * (attemptId) попытку исчерпаны; фрагмент сохранён, но больше не
   * трогается автоматически. Отсутствует/"pending" — обычный статус.
   */
  status?: "pending" | "quarantined";
  /** Причина ухода в quarantine — для диагностики (heartbeat/логи), не для UI. */
  quarantineReason?: string;
  quarantinedAt?: number;
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
        // Намеренно null, а не отсутствие поля — см. заголовок файла:
        // "ещё ни к чему не привязан" должно быть явным состоянием, а
        // не угадываться из отсутствия ключа.
        attemptId: null,
        status: "pending",
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

/**
 * Привязывает фрагмент к КОНКРЕТНОЙ попытке записи — вызывать РОВНО ОДИН
 * РАЗ на фрагмент, до первого authorize (см. ChunkUploader.claimAndUpload()
 * в uploader.ts), и никогда повторно с другим attemptId. Не бросает и не
 * гарантирует запись (см. catch) — это тоже сеть безопасности: если сама
 * привязка не сохранится, фрагмент останется attemptId: null и будет
 * подхвачен как "ничей" при следующем flushPending(), что для
 * ДЕЙСТВИТЕЛЬНО не подтверждённого нигде фрагмента безопасно (см.
 * заголовок файла).
 */
export async function claimPendingChunk(
  sessionId: string,
  role: TrackRole,
  sequence: number,
  attemptId: string
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const key = chunkKey(sessionId, role, sequence);
      const getRequest = store.get(key);
      getRequest.onsuccess = () => {
        const record = getRequest.result as (Record<string, unknown> & { key: string }) | undefined;
        if (!record) {
          // Запись уже удалена (например, конкурентный путь успел
          // подтвердить и удалить её первым) — привязывать нечего.
          return;
        }
        store.put({ ...record, attemptId });
      };
      getRequest.onerror = () => reject(getRequest.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // См. комментарий к функции выше — best-effort.
  }
}

/**
 * Переводит фрагмент в quarantine — вызывать, когда дозагрузка СТРОГО в
 * его собственную (уже привязанную) попытку исчерпала все повторы (см.
 * giveUp() в uploader.ts). Данные не удаляются: явная изоляция вместо
 * молчаливого смешения с другой попыткой.
 */
export async function quarantinePendingChunk(
  sessionId: string,
  role: TrackRole,
  sequence: number,
  reason: string
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const key = chunkKey(sessionId, role, sequence);
      const getRequest = store.get(key);
      getRequest.onsuccess = () => {
        const record = getRequest.result as (Record<string, unknown> & { key: string }) | undefined;
        if (!record) return;
        store.put({ ...record, status: "quarantined", quarantineReason: reason, quarantinedAt: Date.now() });
      };
      getRequest.onerror = () => reject(getRequest.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Best-effort — при неудаче фрагмент останется обычным pending и
    // получит ещё одну попытку resume на следующем flushPending().
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

/**
 * Все ещё не подтверждённые фрагменты этой сессии — для ретрая при
 * старте/восстановлении сети. attemptId нормализуется к null для
 * legacy-записей без этого поля (см. заголовок файла) — вызывающий код
 * (ChunkUploader.flushPending()) никогда не видит undefined.
 */
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
    return result
      .map(chunk => ({ ...chunk, attemptId: chunk.attemptId ?? null }))
      .sort((a, b) => (a.role === b.role ? a.sequence - b.sequence : a.role.localeCompare(b.role)));
  } catch {
    return [];
  }
}
