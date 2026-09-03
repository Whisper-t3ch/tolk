// ============================================================
// Клиент self-hosted GigaAM ASR-сервиса (расшифровка аудио сессий).
// Серверный код — вызывается из воркер-роута /api/sessions/[id]/transcribe
// после того, как запись сессии (Jibri) появилась на ВМ.
//
// Архитектура (согласовано с фаундером 2026-09-03): GigaAM разворачивается
// на той же ВМ, что и Jitsi/Jibri — self-hosted, а не облачный API,
// потому что: (1) себестоимость на масштабе (SpeechKit — платный
// per-request), (2) аудио клиентов не должно покидать инфраструктуру
// (ФЗ-152, обещание в презентации продукта), (3) уже заложено в
// юнит-экономику. ВМ ещё не куплена на момент написания этого файла —
// ASR_SERVICE_URL не задан в .env, поэтому transcribeAudio() бросает
// понятную ошибку вместо сетевого таймаута. Как только ВМ будет готова
// и GigaAM развёрнут, достаточно задать ASR_SERVICE_URL — остальной
// пайплайн (transcribe route, SOAP, RAG, суммаризация) уже готов и
// ничего менять не потребуется.
//
// Ожидаемый контракт self-hosted сервиса (согласовать при деплое,
// это рабочее предположение под HTTP-обёртку GigaAM):
//   POST {ASR_SERVICE_URL}/transcribe
//     body: { audio_url: string } ИЛИ multipart/form-data с файлом
//     → { text: string, duration_seconds?: number, segments?: [...] }
// ============================================================

export class AsrError extends Error {
  constructor(message: string, public code: "not_configured" | "request_failed" | "bad_response") {
    super(message);
    this.name = "AsrError";
  }
}

export interface AsrEnvStatus {
  configured: boolean;
}

export function checkAsrEnv(): AsrEnvStatus {
  return { configured: Boolean(process.env.ASR_SERVICE_URL) };
}

export interface TranscribeResult {
  text: string;
  durationSeconds: number | null;
}

/**
 * Отправляет ссылку на аудио/видео запись сессии в GigaAM-сервис и
 * возвращает расшифрованный текст. Запись должна быть доступна по URL,
 * который сможет открыть сам ASR-сервис (тот же внутренний сервер или
 * presigned Supabase Storage URL — способ хранения записей уточняется
 * при деплое Jibri, см. lib/asr.README в задаче деплоя).
 *
 * Пока ASR_SERVICE_URL не настроен (ВМ ещё не куплена/не развёрнута),
 * бросает AsrError("not_configured") — вызывающий код (transcribe route)
 * должен явно обработать этот случай и сообщить психологу понятным
 * текстом, а не падать с невнятной сетевой ошибкой.
 */
export async function transcribeAudio(audioUrl: string): Promise<TranscribeResult> {
  const serviceUrl = process.env.ASR_SERVICE_URL;
  if (!serviceUrl) {
    throw new AsrError(
      "ASR-сервис (GigaAM) ещё не настроен — задайте ASR_SERVICE_URL после развёртывания на ВМ.",
      "not_configured"
    );
  }

  let response: Response;
  try {
    response = await fetch(`${serviceUrl.replace(/\/$/, "")}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_url: audioUrl }),
    });
  } catch (e) {
    throw new AsrError(
      `Не удалось связаться с ASR-сервисом: ${e instanceof Error ? e.message : String(e)}`,
      "request_failed"
    );
  }

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new AsrError(`ASR-сервис вернул ошибку ${response.status}${details ? `: ${details}` : ""}`, "request_failed");
  }

  const data = await response.json().catch(() => null);
  const text: unknown = data?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new AsrError("ASR-сервис вернул неожиданный формат ответа (нет поля text)", "bad_response");
  }

  const durationSeconds = typeof data?.duration_seconds === "number" ? data.duration_seconds : null;
  return { text: text.trim(), durationSeconds };
}
