// ============================================================
// Runtime-выбор аудиоформата для MediaRecorder.
//
// Формат нельзя захардкодить: Chrome/Chromium обычно даёт WebM/Opus,
// Safari — MP4/AAC. Поэтому кандидаты перебираются в порядке
// предпочтения через MediaRecorder.isTypeSupported().
//
// ВАЖНОЕ ОГРАНИЧЕНИЕ: isTypeSupported() === true означает только
// заявленную браузером поддержку. Фактическая запись всё равно может
// провалиться (нехватка ресурсов, отсутствие кодека в конкретной
// сборке). Поэтому preflight не доверяет этому флагу и дополнительно
// пишет тестовый фрагмент, проверяя, что Blob получился непустым.
//
// Backend обязан принимать оба семейства форматов и приводить их к
// единому PCM/WAV перед GigaAM.
// ============================================================

/** Порядок предпочтения. Opus первым — лучшее качество на битрейт для речи. */
export const MIME_CANDIDATES: readonly string[] = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/webm",
  "audio/ogg;codecs=opus",
] as const;

/**
 * true, если в этом браузере вообще есть MediaRecorder.
 * В SSR-окружении (сборка Next.js) window отсутствует — возвращаем false
 * вместо падения, вызывающий код работает только на клиенте.
 */
export function isMediaRecorderAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined";
}

/** Все поддерживаемые браузером кандидаты — для отчёта preflight. */
export function listSupportedMimeTypes(): string[] {
  if (!isMediaRecorderAvailable()) return [];
  return MIME_CANDIDATES.filter(type => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  });
}

/**
 * Первый поддерживаемый формат, либо null — тогда записывать нельзя и
 * preflight обязан заблокировать старт записываемой консультации,
 * предложив другой браузер. Серверного источника аудио в этой
 * архитектуре нет, поэтому «запишем как-нибудь потом» не вариант.
 */
export function selectMimeType(): string | null {
  return listSupportedMimeTypes()[0] ?? null;
}

/**
 * Расширение файла для ключа объекта в хранилище. Нужно, чтобы backend
 * при сборке дорожки понимал контейнер, не разбирая бинарь.
 */
export function extensionForMimeType(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  if (base === "audio/webm") return "webm";
  if (base === "audio/mp4") return "m4a";
  if (base === "audio/ogg") return "ogg";
  return "bin";
}
