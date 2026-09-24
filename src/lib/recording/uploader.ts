// ============================================================
// Выгрузка фрагментов записи на backend (Этап 2 архитектуры).
//
// ИЗМЕНЕНО 24.09.2026 — прямая загрузка в Storage вместо проксирования
// байт через Vercel:
//   1. authorize: маленький JSON-запрос на
//      /api/sessions/[id]/recording/chunks/authorize — сервер проверяет
//      владение сессией и выдаёт подписанный Supabase-токен на
//      конкретный путь (createSignedUploadUrl, upsert:true — важно для
//      идемпотентности retry, см. ниже).
//   2. upload: Blob фрагмента грузится НАПРЯМУЮ в Supabase Storage из
//      браузера через uploadToSignedUrl — Vercel эти байты не видит и
//      не тратит на них execution time/квоту serverless-функции.
//   3. confirm: маленький JSON-запрос на .../recording/chunks (теперь
//      это JSON-only endpoint, не multipart) с метаданными фрагмента —
//      сервер сверяет размер объекта в Storage (не байты) и пишет
//      строку в session_recording_chunks.
//
// Раньше (до этого изменения) шаг был один: multipart/form-data POST с
// самим Blob на /recording/chunks, backend сам грузил байты в Storage.
// Работало, но каждый фрагмент дважды проезжал через Vercel serverless
// function — лишний прыжок, который сейчас устранён. См. комментарии в
// route.ts обоих эндпоинтов для деталей и честной оговорки про то, что
// сервер больше не пересчитывает checksum от реальных байт (это теперь
// делается только на этапе сборки дорожки перед GigaAM, Этап 3).
//
// Последовательность на фрагмент (архитектурный документ, раздел
// "Запись фрагментами"): получить Blob → сохранить в IndexedDB
// (chunkStore.ts, ДО первой попытки) → authorize → upload → confirm →
// удалить из IndexedDB по подтверждению. Backend хранит идемпотентность
// через уникальность (session_id, track, sequence) и upsert и в БД, и
// в Storage (upsert:true на signed URL) — поэтому повторная отправка
// одного и того же фрагмента при retry безопасна и не создаёт дублей.
//
// Namespace для двух дорожек не разделяется: очередь общая, но каждый
// фрагмент несёт свою role/sequence, backend раскладывает по треку сам.
// ============================================================

import type { RecordedChunk } from "./types";
import type { RecordingManifest } from "./types";
import type { RecordingStatusSnapshot } from "./sessionRecorder";
import { putPendingChunk, deletePendingChunk, getAllPendingChunks } from "./chunkStore";
import { createClient } from "@/lib/supabase/client";

const RETRY_DELAYS_MS = [1000, 3000, 8000, 20000, 60000];
const MAX_RETRIES = RETRY_DELAYS_MS.length;

const RECORDING_BUCKET = "session-recordings";

/**
 * Ошибка, повтор которой заведомо не поможет — тот же запрос с тем же
 * телом снова получит тот же 4xx (например, 409 "коллизия checksum на
 * confirm", см. route.ts). uploadWithRetry прекращает попытки сразу,
 * не тратя всю цепочку RETRY_DELAYS_MS впустую (~90с) на то, что не
 * может исправиться само. Добавлено 24.09 вместе с идемпотентной
 * проверкой на confirm-эндпоинте.
 */
class NonRetryableUploadError extends Error {}

export interface ChunkUploaderOptions {
  sessionId: string;
  /** Подменяется в тестах; по умолчанию — глобальный fetch. */
  fetchImpl?: typeof fetch;
  /** Подменяется в тестах; по умолчанию — обычный browser Supabase client. */
  storageClient?: ReturnType<typeof createClient>;
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
  private readonly storage: ReturnType<typeof createClient>;
  private readonly onChunkUploaded?: (chunk: RecordedChunk) => void;
  private readonly onChunkGaveUp?: (chunk: RecordedChunk, error: Error) => void;
  /** Незавершённые задачи выгрузки (включая retry-цепочку) — нужно для waitForIdle(). */
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(options: ChunkUploaderOptions) {
    this.sessionId = options.sessionId;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.storage = options.storageClient ?? createClient();
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
      if (error instanceof NonRetryableUploadError) {
        // 4xx от authorize/confirm — тот же запрос с тем же телом
        // снова получит тот же ответ (например, 409-коллизия
        // checksum). Повтор не поможет, сразу считаем попытки
        // исчерпанными вместо ~90с бессмысленных retry.
        this.onChunkGaveUp?.(chunk, error);
        return;
      }
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

  /**
   * Три шага: authorize (JSON, маленький) → upload (Blob, напрямую в
   * Storage, Vercel не видит) → confirm (JSON, маленький). Если
   * ЛЮБОЙ из трёх шагов упал — весь метод бросает, uploadWithRetry
   * повторит все три шага заново с нуля (не пытается продолжить с
   * середины — так проще рассуждать о состоянии, а upsert:true на
   * signed URL и upsert в БД делают повтор с начала безопасным).
   */
  private async uploadOnce(chunk: RecordedChunk): Promise<void> {
    const authorizeResponse = await this.fetchImpl(
      `/api/sessions/${this.sessionId}/recording/chunks/authorize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          track: chunk.role,
          sequence: chunk.sequence,
          mimeType: chunk.mimeType,
        }),
      }
    );
    if (!authorizeResponse.ok) {
      const text = await authorizeResponse.text().catch(() => "");
      const message = `Не удалось получить разрешение на загрузку фрагмента ${chunk.role}#${chunk.sequence}: ${authorizeResponse.status} ${text}`;
      if (authorizeResponse.status >= 400 && authorizeResponse.status < 500) {
        throw new NonRetryableUploadError(message);
      }
      throw new Error(message);
    }
    const authorized = (await authorizeResponse.json()) as { path: string; token: string };

    const { error: uploadError } = await this.storage.storage
      .from(RECORDING_BUCKET)
      .uploadToSignedUrl(authorized.path, authorized.token, chunk.blob, {
        contentType: chunk.mimeType,
      });
    if (uploadError) {
      throw new Error(
        `Прямая загрузка фрагмента ${chunk.role}#${chunk.sequence} в хранилище не удалась: ${uploadError.message}`
      );
    }

    const confirmResponse = await this.fetchImpl(`/api/sessions/${this.sessionId}/recording/chunks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        track: chunk.role,
        sequence: chunk.sequence,
        startedAtMs: chunk.startedAtMs,
        durationMs: chunk.durationMs,
        checksum: chunk.checksum,
        mimeType: chunk.mimeType,
        sizeBytes: chunk.size,
      }),
    });
    if (!confirmResponse.ok) {
      const text = await confirmResponse.text().catch(() => "");
      const message = `Подтверждение фрагмента ${chunk.role}#${chunk.sequence} не удалось: ${confirmResponse.status} ${text}`;
      if (confirmResponse.status >= 400 && confirmResponse.status < 500) {
        // 409 "коллизия checksum" (см. route.ts) чаще всего — 4xx в
        // принципе не тот случай, где повтор того же тела спасает.
        throw new NonRetryableUploadError(message);
      }
      throw new Error(message);
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
