// ============================================================
// Выгрузка фрагментов записи на backend (Этап 2 архитектуры).
//
// 24.09.2026 — прямая загрузка в Storage вместо проксирования байт
// через Vercel:
//   0. ensureAttempt (новое, тот же день, вторая правка): один раз за
//      время жизни этого ChunkUploader — POST .../recording/attempts,
//      сервер сам генерирует recording_attempt_id (см. тот route и
//      migration_038_recording_attempt_id.sql) и с этого момента
//      участвует в КАЖДОМ authorize/confirm запросе этого uploader'а.
//      Перезагрузка вкладки создаёт новый ChunkUploader → новый
//      attempt_id → новый префикс пути в Storage — коллизия путей
//      между "старой" и "новой" попыткой записи одной консультации
//      структурно невозможна, а не просто поймана постфактум.
//   1. authorize: маленький JSON-запрос на
//      /api/sessions/[id]/recording/chunks/authorize (теперь включает
//      attemptId) — сервер проверяет владение сессией и attempt_id, и
//      либо отвечает alreadyConfirmed:true (этот фрагмент уже реально
//      долетел в прошлый раз — см. ниже), либо выдаёт подписанный
//      Supabase-токен на конкретный путь. upsert:true на этом токене
//      выдаётся ТОЛЬКО если фрагмент ещё НЕ подтверждён — см.
//      комментарий в route.ts, почему это больше не "upsert решает
//      коллизию", а просто безопасный retry внутри ещё не
//      подтверждённой попытки.
//   2. upload (пропускается, если authorize вернул alreadyConfirmed):
//      Blob фрагмента грузится НАПРЯМУЮ в Supabase Storage из браузера
//      через uploadToSignedUrl — Vercel эти байты не видит.
//   3. confirm (тоже пропускается при alreadyConfirmed): маленький
//      JSON-запрос на .../recording/chunks с метаданными фрагмента —
//      сервер сверяет размер объекта в Storage (не байты) и пишет
//      строку в session_recording_chunks.
//
// alreadyConfirmed — это НЕ то же самое, что "upsert решает
// идемпотентность": это ответ на вопрос "если браузер честно не
// получил ответ confirm в прошлый раз (сеть оборвалась ПОСЛЕ того,
// как сервер уже записал строку), нужно ли гонять Blob повторно?" —
// нет, потому что сервер уже знает, что этот (attempt_id, track,
// sequence) подтверждён, и НЕ выдаст новый токен на его перезапись
// (см. route.ts) — простой ретрай с начала (authorize→upload→confirm)
// в этом случае просто получает alreadyConfirmed:true на первом же
// шаге вместо токена, ничего заново не грузит.
//
// Раньше (до 24.09) шаг был один: multipart/form-data POST с самим
// Blob на /recording/chunks, backend сам грузил байты в Storage —
// каждый фрагмент дважды проезжал через Vercel serverless function.
// См. комментарии в route.ts обоих эндпоинтов про честную оговорку о
// том, что сервер не пересчитывает checksum от реальных байт (это
// теперь делается только на этапе сборки дорожки перед GigaAM, Этап 3).
//
// Последовательность на фрагмент (архитектурный документ, раздел
// "Запись фрагментами"): получить Blob → сохранить в IndexedDB
// (chunkStore.ts, ДО первой попытки) → ensureAttempt → authorize →
// upload → confirm → удалить из IndexedDB по подтверждению.
//
// Namespace для двух дорожек не разделяется: очередь общая, но каждый
// фрагмент несёт свою role/sequence, backend раскладывает по треку сам.
// Обе дорожки одного uploader'а используют ОДИН И ТОТ ЖЕ attempt_id —
// это одна попытка записи консультации, а не отдельная попытка на
// дорожку.
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
  /**
   * Кэш recording_attempt_id для этого uploader'а (см. ensureAttempt()
   * ниже) — один на весь его жизненный цикл, обе дорожки его
   * переиспользуют. null, пока ни один фрагмент ещё не пытались
   * выгрузить.
   */
  private attemptId: string | null = null;
  /** В процессе запроса на создание попытки — чтобы конкурентные вызовы ensureAttempt() не создали две попытки разом. */
  private attemptRequest: Promise<string> | null = null;

  constructor(options: ChunkUploaderOptions) {
    this.sessionId = options.sessionId;
    // fetch не привязан к window/globalThis по умолчанию — нативная
    // реализация требует this === window (или globalThis) изнутри, а все
    // вызовы здесь идут как this.fetchImpl(...), то есть как МЕТОД этого
    // класса. Без .bind(globalThis) это на каждый вызов кидает
    // TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation
    // — исключение уходит ДО реальной попытки сети, поэтому ни один запрос
    // не долетает до сервера ни разу, даже после всех retry (обнаружено
    // 25.09.2026 живым тестом: 0 запросов в логах Vercel за всё время теста,
    // хотя uploadWithRetry честно проходил все 5 попыток и звал onChunkGaveUp).
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.storage = options.storageClient ?? createClient();
    this.onChunkUploaded = options.onChunkUploaded;
    this.onChunkGaveUp = options.onChunkGaveUp;
  }

  /**
   * Текущий recording_attempt_id этого uploader'а, если он уже
   * получен (см. ensureAttempt()) — null до первой успешной попытки
   * выгрузки. Нужен снаружи (JitsiCallView) только для того, чтобы
   * подписать диагностику остановки (StopDiagnosticEvent) тем же
   * attempt_id, каким подписаны фрагменты этой попытки — сам
   * uploader ничего не знает о диагностике remoteRecorder'ов.
   */
  getAttemptId(): string | null {
    return this.attemptId;
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
   * Один раз за время жизни этого uploader'а получает серверный
   * recording_attempt_id (см. .../recording/attempts/route.ts).
   * Конкурентные вызовы (несколько фрагментов enqueue'ятся почти
   * одновременно) синхронно видят один и тот же ещё не завершённый
   * attemptRequest и ждут его же — не создают вторую попытку. При
   * неудаче attemptRequest сбрасывается, чтобы следующий вызов
   * (следующий фрагмент или retry того же) попробовал заново, а не
   * навсегда остался с отклонённым промисом; attemptId, наоборот,
   * выставляется ТОЛЬКО при успехе и после этого больше никогда не
   * запрашивается заново — все фрагменты обеих дорожек этого
   * uploader'а обязаны попасть в одну и ту же попытку записи.
   */
  private async ensureAttempt(): Promise<string> {
    if (this.attemptId) return this.attemptId;
    if (!this.attemptRequest) {
      this.attemptRequest = (async () => {
        const response = await this.fetchImpl(`/api/sessions/${this.sessionId}/recording/attempts`, {
          method: "POST",
        });
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(`Не удалось создать попытку записи: ${response.status} ${text}`);
        }
        const data = (await response.json()) as { attemptId: string };
        return data.attemptId;
      })();
    }
    try {
      const id = await this.attemptRequest;
      this.attemptId = id;
      return id;
    } finally {
      this.attemptRequest = null;
    }
  }

  /**
   * Четыре шага: ensureAttempt → authorize (JSON, маленький) → upload
   * (Blob, напрямую в Storage, Vercel не видит) → confirm (JSON,
   * маленький) — либо authorize сразу отвечает alreadyConfirmed:true и
   * шаги upload/confirm пропускаются целиком (см. заголовок файла).
   * Если ЛЮБОЙ из шагов упал — весь метод бросает, uploadWithRetry
   * повторит с нуля (кроме attemptId — он к этому моменту уже
   * закэширован и повторно не запрашивается, см. ensureAttempt()).
   */
  private async uploadOnce(chunk: RecordedChunk): Promise<void> {
    const attemptId = await this.ensureAttempt();

    const authorizeResponse = await this.fetchImpl(
      `/api/sessions/${this.sessionId}/recording/chunks/authorize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attemptId,
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
    const authorized = (await authorizeResponse.json()) as {
      alreadyConfirmed: boolean;
      path?: string;
      token?: string;
    };

    if (authorized.alreadyConfirmed) {
      // Этот (attempt_id, track, sequence) уже подтверждён на backend —
      // предыдущая попытка реально долетела, просто ответ не дошёл до
      // браузера (или это повторный вызов flushPending). Grузить и
      // подтверждать заново нечего.
      return;
    }
    if (!authorized.path || !authorized.token) {
      throw new Error(
        `authorize вернул успешный ответ без path/token для фрагмента ${chunk.role}#${chunk.sequence} — некорректный контракт`
      );
    }

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
        attemptId,
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

  /**
   * Manifest после остановки записи — backend сверяет его с реестром
   * фрагментов и решает финальный статус. attemptId подставляется
   * здесь (не в SessionRecorder — он про backend/uploader ничего не
   * знает) из уже закэшированного this.attemptId; null, если за всю
   * попытку не выгрузили ни одного фрагмента (тогда backend сверяет
   * по сессии в целом, см. .../recording/manifest/route.ts).
   */
  async sendManifest(manifest: RecordingManifest): Promise<{ ok: boolean; status?: string }> {
    try {
      const response = await this.fetchImpl(`/api/sessions/${this.sessionId}/recording/manifest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...manifest, attemptId: this.attemptId }),
      });
      if (!response.ok) return { ok: false };
      const data = await response.json().catch(() => null);
      return { ok: true, status: data?.status };
    } catch {
      return { ok: false };
    }
  }
}
