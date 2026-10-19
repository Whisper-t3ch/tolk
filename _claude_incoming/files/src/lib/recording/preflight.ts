// ============================================================
// Preflight — проверка устройства психолога за 10-20 секунд до входа
// в комнату.
//
// Зачем это обязательный шаг, а не необязательная диагностика: в
// браузерной архитектуре записи серверного источника аудио нет вообще.
// Если рекордер не заработает, запись консультации не появится ниоткуда
// — и психолог узнает об этом через час, когда транскрипт не придёт.
// Поэтому при красном preflight записываемую консультацию начинать
// нельзя.
//
// Проверки намеренно идут от дешёвых к дорогим и ранний провал
// прекращает цепочку: нет смысла просить микрофон, если MediaRecorder
// в этом браузере отсутствует.
// ============================================================

import { isMediaRecorderAvailable, listSupportedMimeTypes, selectMimeType } from "./mime";

export type PreflightCheckId =
  | "media_recorder"
  | "mime_type"
  | "microphone"
  | "test_recording"
  | "indexed_db"
  | "storage_quota"
  | "webrtc"
  | "upload";

export type PreflightCheckStatus = "pass" | "fail" | "skipped";

export interface PreflightCheck {
  id: PreflightCheckId;
  status: PreflightCheckStatus;
  /** Текст для психолога — на русском, без технического жаргона. */
  message: string;
}

/** Что делать по итогам — соответствует таблице решений в архитектуре. */
export type PreflightVerdict =
  /** Все проверки успешны — разрешить начало консультации. */
  | "allow"
  /** Не найден поддерживаемый формат — предложить другой браузер. */
  | "unsupported_browser"
  /** Нет доступа к микрофону — показать инструкцию по разрешениям. */
  | "microphone_blocked"
  /** Недостаточно локального места — освободить место или сменить устройство. */
  | "insufficient_storage"
  /** Не работает тестовая запись — блокировать записываемую консультацию. */
  | "recording_broken"
  /** Не работает загрузка — повторить проверку; старт только по явному решению психолога. */
  | "upload_broken";

export interface PreflightResult {
  verdict: PreflightVerdict;
  checks: PreflightCheck[];
  mimeType: string | null;
  supportedMimeTypes: string[];
  storageRemainingBytes: number | null;
}

export interface PreflightOptions {
  /**
   * Проверка выгрузки: запросить upload URL и положить туда пробный
   * объект. Необязательна — без неё preflight не поймает сломанное
   * хранилище, поэтому в продакшене её нужно передавать.
   */
  probeUpload?: () => Promise<void>;
  /** Длительность тестовой записи, мс. */
  testRecordingMs?: number;
  /** Минимум свободного места в браузерном хранилище. */
  minStorageBytes?: number;
  /**
   * Откуда взять аудиопоток для проверки. По умолчанию — микрофон
   * через getUserMedia.
   *
   * Параметризовано по двум причинам. Первая: когда звонок уже поднят
   * (lib-jitsi-meet сам держит локальную дорожку), повторный
   * getUserMedia открывает устройство второй раз — лучше передать
   * существующий поток. Вторая: в средах без аудиоустройств
   * (CI, контейнер) getUserMedia падает с NotFoundError, и без этой
   * точки подмены остальные проверки нечем прогнать.
   */
  getMicrophoneStream?: () => Promise<MediaStream>;
  /**
   * Останавливать ли дорожки потока после проверки. false, когда поток
   * пришёл снаружи и будет использоваться дальше в звонке.
   */
  stopStreamAfterCheck?: boolean;
}

/**
 * Часовая консультация двумя дорожками в Opus ~32 кбит/с даёт порядка
 * 30 МБ. IndexedDB держит только неотправленные фрагменты, но при
 * получасовом отсутствии сети очередь дорастает примерно до этого
 * объёма — поэтому запас берём с кратностью.
 */
export const DEFAULT_MIN_STORAGE_BYTES = 200 * 1024 * 1024;

const TEST_DB_NAME = "tolk-preflight";

export async function runPreflight(options: PreflightOptions = {}): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];
  const testRecordingMs = options.testRecordingMs ?? 500;
  const minStorageBytes = options.minStorageBytes ?? DEFAULT_MIN_STORAGE_BYTES;

  const finish = (verdict: PreflightVerdict, extra: Partial<PreflightResult> = {}): PreflightResult => ({
    verdict,
    checks,
    mimeType: extra.mimeType ?? null,
    supportedMimeTypes: extra.supportedMimeTypes ?? [],
    storageRemainingBytes: extra.storageRemainingBytes ?? null,
  });

  const skipRest = (from: PreflightCheckId[]) => {
    for (const id of from) {
      checks.push({ id, status: "skipped", message: "Проверка пропущена" });
    }
  };

  // 1. MediaRecorder
  if (!isMediaRecorderAvailable()) {
    checks.push({ id: "media_recorder", status: "fail", message: "Браузер не умеет записывать звук" });
    skipRest(["mime_type", "microphone", "test_recording", "indexed_db", "storage_quota", "webrtc", "upload"]);
    return finish("unsupported_browser");
  }
  checks.push({ id: "media_recorder", status: "pass", message: "Запись звука поддерживается" });

  // 2. Формат
  const supportedMimeTypes = listSupportedMimeTypes();
  const mimeType = selectMimeType();
  if (!mimeType) {
    checks.push({ id: "mime_type", status: "fail", message: "Нет поддерживаемого формата записи" });
    skipRest(["microphone", "test_recording", "indexed_db", "storage_quota", "webrtc", "upload"]);
    return finish("unsupported_browser", { supportedMimeTypes });
  }
  checks.push({ id: "mime_type", status: "pass", message: `Формат записи: ${mimeType}` });

  // 3. Микрофон
  const acquireStream =
    options.getMicrophoneStream ?? (() => navigator.mediaDevices.getUserMedia({ audio: true }));
  const shouldStopStream = options.stopStreamAfterCheck ?? !options.getMicrophoneStream;

  let stream: MediaStream;
  try {
    stream = await acquireStream();
  } catch (e) {
    const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
    checks.push({
      id: "microphone",
      status: "fail",
      message: denied ? "Доступ к микрофону запрещён" : "Микрофон недоступен",
    });
    skipRest(["test_recording", "indexed_db", "storage_quota", "webrtc", "upload"]);
    return finish("microphone_blocked", { mimeType, supportedMimeTypes });
  }
  checks.push({ id: "microphone", status: "pass", message: "Микрофон доступен" });

  // 4. Тестовая запись. isTypeSupported() обещает поддержку, но
  //    фактическая запись всё равно может дать пустой Blob — только
  //    эта проверка отличает «заявлено» от «работает».
  try {
    const blob = await recordSample(stream, mimeType, testRecordingMs);
    if (!blob || blob.size === 0) {
      checks.push({ id: "test_recording", status: "fail", message: "Тестовая запись получилась пустой" });
      skipRest(["indexed_db", "storage_quota", "webrtc", "upload"]);
      return finish("recording_broken", { mimeType, supportedMimeTypes });
    }
    checks.push({ id: "test_recording", status: "pass", message: "Тестовая запись прошла" });
  } catch (e) {
    checks.push({
      id: "test_recording",
      status: "fail",
      message: `Тестовая запись не удалась: ${e instanceof Error ? e.message : String(e)}`,
    });
    skipRest(["indexed_db", "storage_quota", "webrtc", "upload"]);
    return finish("recording_broken", { mimeType, supportedMimeTypes });
  } finally {
    // Поток, пришедший снаружи, останавливать нельзя — он нужен звонку.
    if (shouldStopStream) stopStream(stream);
  }

  // 5. IndexedDB — буфер неотправленных фрагментов
  const indexedDbOk = await probeIndexedDb();
  if (!indexedDbOk) {
    checks.push({ id: "indexed_db", status: "fail", message: "Браузер не даёт сохранять фрагменты локально" });
    skipRest(["storage_quota", "webrtc", "upload"]);
    return finish("recording_broken", { mimeType, supportedMimeTypes });
  }
  checks.push({ id: "indexed_db", status: "pass", message: "Локальный буфер работает" });

  // 6. Свободное место
  const storageRemainingBytes = await estimateStorageRemaining();
  if (storageRemainingBytes !== null && storageRemainingBytes < minStorageBytes) {
    checks.push({ id: "storage_quota", status: "fail", message: "Недостаточно места в браузере" });
    skipRest(["webrtc", "upload"]);
    return finish("insufficient_storage", { mimeType, supportedMimeTypes, storageRemainingBytes });
  }
  checks.push({ id: "storage_quota", status: "pass", message: "Места достаточно" });

  // 7. WebRTC
  if (typeof RTCPeerConnection === "undefined") {
    checks.push({ id: "webrtc", status: "fail", message: "Браузер не поддерживает видеозвонки" });
    skipRest(["upload"]);
    return finish("unsupported_browser", { mimeType, supportedMimeTypes, storageRemainingBytes });
  }
  checks.push({ id: "webrtc", status: "pass", message: "Видеосвязь поддерживается" });

  // 8. Выгрузка
  if (!options.probeUpload) {
    checks.push({ id: "upload", status: "skipped", message: "Проверка загрузки не выполнялась" });
    return finish("allow", { mimeType, supportedMimeTypes, storageRemainingBytes });
  }
  try {
    await options.probeUpload();
    checks.push({ id: "upload", status: "pass", message: "Загрузка работает" });
  } catch (e) {
    checks.push({
      id: "upload",
      status: "fail",
      message: `Загрузка не работает: ${e instanceof Error ? e.message : String(e)}`,
    });
    return finish("upload_broken", { mimeType, supportedMimeTypes, storageRemainingBytes });
  }

  return finish("allow", { mimeType, supportedMimeTypes, storageRemainingBytes });
}

/** Записывает короткий фрагмент и отдаёт его Blob. */
function recordSample(stream: MediaStream, mimeType: string, durationMs: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    const parts: Blob[] = [];
    recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) parts.push(e.data);
    };
    recorder.onerror = () => reject(new Error("MediaRecorder сообщил об ошибке"));
    recorder.onstop = () => resolve(new Blob(parts, { type: mimeType }));
    recorder.start();
    setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, durationMs);
  });
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** Открыть базу, записать и прочитать пробное значение, затем удалить базу. */
async function probeIndexedDb(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(TEST_DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("probe");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("probe", "readwrite");
      tx.objectStore("probe").put(new Blob(["ok"]), "probe");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    indexedDB.deleteDatabase(TEST_DB_NAME);
    return true;
  } catch {
    return false;
  }
}

/** Остаток квоты браузерного хранилища, либо null если браузер не сообщает. */
async function estimateStorageRemaining(): Promise<number | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const { quota, usage } = await navigator.storage.estimate();
    if (typeof quota !== "number" || typeof usage !== "number") return null;
    return Math.max(0, quota - usage);
  } catch {
    return null;
  }
}
