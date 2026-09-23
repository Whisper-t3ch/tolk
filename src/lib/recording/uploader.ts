// ============================================================
// Выгрузка фрагментов записи на backend (Этап 2 архитектуры).
//
// Последовательность на фрагмент (см. architecture-spec, раздел
// "Запись фрагментами"): получить Blob → сохранить в IndexedDB
// (chunkStore.ts, ДО первой попытки) → отправить на backend
// (/api/sessions/[id]/recording/chunks) → удалить из IndexedDB по
// подтверждению. Backend хранит идемпотентность через уникальность
// (session_id, track, sequence) и upsert и в БД, и в Storage — поэтому
// повторная отправка одного и того же фрагмента при retry безопасна и
// не создаёт дублей.
//
// Namespace для двух дорожек не разделяется: очередь общая, но каждый
// фрагмент несёт свою role/sequence, backend раскладывает по треку сам.
// ============================================================

import type { RecordedChunk } from "./types";
import type { RecordingManifest } from "./types";
import type { RecordingStatusSnapshot } from "./sessionRecorder";
import { putPendingChunk, deletePendingChunk, getAllPendingChunks } from "./chunkStore";

const RETRY_DELAYS_MS = [1000, 3000, 8000, 20000, 60000];
const MAX_RETRIES = RETRY_DELAYS_MS.length;

export interface ChunkUploaderOptions {
  sessionId: string;
  /** Подменяется в тестах; по умолчанию — глобальный fetch. */
  fetchImpl?: typeof fetch;
  onChunkUploaded?: (chunk: RecordedChunk) => void;
  /** Фрагмент исчерпал все попытки retry — backend недоступен слишком долго. */
  onChunkGaveUp?: (chunk: RecordedChunk, error: Error) => void;
}

/**
 * Очередь выгрузки для одной консультации. Один экземпляр на звонок
 * (создаётся вместе с SessionRecorder в JitsiCallView).
 */
export class ChunkUploader {
  private readonly sessionId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly onChunkUploaded?: (chunk: RecordedChunk) => void;
  private readonly onChunkGaveUp?: (chunk: RecordedChunk, error: Error) => void;
  /** Незавершённые задачи выгрузки (включая retry-цепочку) — нужно для waitForIdle(). */
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(options: ChunkUploaderOptions) {
    this.sessionId = options.sessionId;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.onChunkUploaded = options.onChunkUploaded;
    this.onChunkGaveUp = options.onChunkGaveUp;
  }

  /** Новый фрагмент от TrackRecorder. Не блокирует запись — сама выгрузка идёт в фоне. */
  enqueue(chunk: RecordedChunk): void {
    const key = `${chunk.role}:${chunk.sequence}`;
    const task = putPendingChunk(this.sessionId, chunk)
      .then(() => this.uploadWithRetry(chunk, 0))
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, task);
  }

  /**
   * Дожидается, пока все текущие попытки выгрузки (включая retry с
   * задержками) завершатся — успехом или исчерпанием попыток. Вызывать
   * перед отправкой manifest: иначе backend может увидеть "дыру" в
   * реестре только потому, что последний фрагмент ещё в пути, а не
   * потому что он реально потерян.
   *
   * timeoutMs ограничивает ожидание сверху: суммарно retry одного
   * фрагмента может растянуться почти на полторы минуты (см.
   * RETRY_DELAYS_MS), а страницу нельзя блокировать настолько долго —
   * по истечении таймаута просто отдаём управление обратно, недошедшие
   * фрагменты останутся в IndexedDB и manifest честно покажет
   * 'incomplete', если они не успели попасть в реестр.
   */
  async waitForIdle(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.inFlight.size > 0 && Date.now() < deadline) {
      const remaining = deadline - Date.now();
      await Promise.race([
        Promise.allSettled([...this.inFlight.values()]),
        new Promise(resolve => setTimeout(resolve, remaining)),
      ]);
    }
  }

  /**
   * Повторная попытка выгрузить всё, что осталось в IndexedDB —
   * вызывать при старте записи (на случай осиротевших фрагментов
   * прошлого монтирования в этой же вкладке) и можно дополнительно по
   * событию online, если потребуется агрессивнее реагировать на
   * восстановление сети.
   */
  async flushPending(): Promise<void> {
    const pending = await getAllPendingChunks(this.sessionId);
    for (const chunk of pending) {
      const key = `${chunk.role}:${chunk.sequence}`;
      if (this.inFlight.has(key)) continue;
      const task = this.uploadWithRetry(chunk, 0).finally(() => {
        this.inFlight.delete(key);
      });
      this.inFlight.set(key, task);
    }
  }

  private async uploadWithRetry(chunk: RecordedChunk, attempt: number): Promise<void> {
    try {
      await this.uploadOnce(chunk);
      await deletePendingChunk(this.sessionId, chunk.role, chunk.sequence);
      this.onChunkUploaded?.(chunk);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      if (attempt >= MAX_RETRIES) {
        // Фрагмент остаётся в IndexedDB — при следующем flushPending()
        // (например, новая попытка heartbeat нашла живую сеть) будет
        // предпринята ещё одна серия попыток, а не потерян навсегда.
        this.onChunkGaveUp?.(chunk, error);
        return;
      }
      const delay = RETRY_DELAYS_MS[attempt];
      await new Promise(resolve => setTimeout(resolve, delay));
      await this.uploadWithRetry(chunk, attempt + 1);
    }
  }

  private async uploadOnce(chunk: RecordedChunk): Promise<void> {
    const form = new FormData();
    form.set("track", chunk.role);
    form.set("sequence", String(chunk.sequence));
    form.set("startedAtMs", String(chunk.startedAtMs));
    form.set("durationMs", String(chunk.durationMs));
    form.set("checksum", chunk.checksum);
    form.set("mimeType", chunk.mimeType);
    form.set("blob", chunk.blob, `${chunk.sequence}`);

    const response = await this.fetchImpl(`/api/sessions/${this.sessionId}/recording/chunks`, {
      method: "POST",
      body: form,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Выгрузка фрагмента ${chunk.role}#${chunk.sequence} не удалась: ${response.status} ${text}`);
    }
  }

  /** Heartbeat раз в 10-15 секунд — единственный способ поймать "тихий" отказ записи. */
  async sendHeartbeat(status: RecordingStatusSnapshot): Promise<void> {
    try {
      await this.fetchImpl(`/api/sessions/${this.sessionId}/recording/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(status),
      });
    } catch {
      // Heartbeat лучше пропустить, чем уронить звонок из-за него —
      // следующий тик через 10-15с попробует снова. Backend отдельно
      // заметит длинную тишину по recording_heartbeat_at.
    }
  }

  /** Manifest после остановки записи — backend сверяет его с реестром фрагментов и решает финальный статус. */
  async sendManifest(manifest: RecordingManifest): Promise<{ ok: boolean; status?: string }> {
    try {
      const response = await this.fetchImpl(`/api/sessions/${this.sessionId}/recording/manifest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manifest),
      });
      if (!response.ok) return { ok: false };
      const data = await response.json().catch(() => null);
      return { ok: true, status: data?.status };
    } catch {
      return { ok: false };
    }
  }
}
