// ------------------------------------------------------------
// Загрузка аудиозаписи прошедшей встречи (запись, сделанная вне платформы): файл → GigaAM на ВМ → текст →
// обезличивание → session_transcripts + RAG-чанки (тот же путь, что у текстовой загрузки).
// Файл нигде не сохраняется: он живёт в памяти, пока идёт расшифровка. Голоса не разделяются (одна дорожка),
// поэтому в тексте нет пометок «Психолог/Клиент».
// ------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { Agent, fetch as undiciFetch, FormData as UndiciFormData } from "undici";
import { createHttpAsrAdapter, type AsrAdapter, type AsrSegment } from "./asrAdapter";
import { saveSessionTranscript } from "@/lib/saveSessionTranscript";
import { AnonymizationError } from "@/lib/anonymize";
import { buildTurns, labelSpeakers, SPEAKER_NOTE } from "./speakerLabels";

export const MAX_AUDIO_BYTES = 55 * 1024 * 1024;
export const ALLOWED_AUDIO_EXTENSIONS = ["mp3", "m4a", "wav", "ogg", "oga", "opus", "webm", "aac", "flac", "mp4", "amr"] as const;

/** Расширение файла из списка допустимых или null. */
export function audioExtension(fileName: string, mime?: string): string | null {
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
  if (ext && (ALLOWED_AUDIO_EXTENSIONS as readonly string[]).includes(ext)) return ext;
  if (mime && /^audio\//.test(mime)) return "webm";
  return null;
}

/** Сегменты ASR по одному на строку: так их можно разметить по говорящим после обезличивания. */
export function segmentsToLines(segments: AsrSegment[]): string {
  return segments.map(s => s.text.trim().replace(/\s+/g, " ")).filter(Boolean).join("\n");
}

/** Обезличенный текст (по строке на фрагмент) → реплики «Психолог/Клиент»; при неудаче разметки — абзацы без меток. */
export async function labelAnonymizedText(anonymized: string): Promise<string> {
  const units = anonymized.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const labels = await labelSpeakers(units);
  if (!labels) return units.join("\n\n");
  return `${SPEAKER_NOTE}\n\n${buildTurns(units, labels)}`;
}

/** Склеивает сегменты ASR в абзацы: новый абзац после паузы больше 3 секунд или каждые ~600 символов. */
export function segmentsToText(segments: AsrSegment[]): string {
  const paragraphs: string[] = [];
  let current = "";
  let lastEnd = 0;
  for (const seg of segments) {
    const t = seg.text.trim();
    if (!t) continue;
    const pause = seg.startMs - lastEnd;
    if (current && (pause > 3000 || current.length > 600)) {
      paragraphs.push(current);
      current = "";
    }
    current = current ? `${current} ${t}` : t;
    lastEnd = seg.endMs;
  }
  if (current) paragraphs.push(current);
  return paragraphs.join("\n\n");
}

/** fetch без 5-минутного ограничения на ожидание ответа: расшифровка длинной записи на CPU идёт дольше. */
export function createLongFetch(): typeof fetch {
  const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 30_000 });
  return ((input: unknown, init?: unknown) => undiciFetch(input as never, { ...(init as object), dispatcher } as never)) as unknown as typeof fetch;
}

/** Адаптер ASR для загрузки файлов: реальный сервис, если он настроен. null — ASR на сервере не подключён. */
export function pickUploadAdapter(fileExt: string): AsrAdapter | null {
  const url = process.env.ASR_SERVICE_URL;
  if (process.env.RECORDING_ASR_ADAPTER !== "http" || !url) return null;
  return createHttpAsrAdapter(url, { authToken: process.env.ASR_SERVICE_TOKEN, fetchImpl: createLongFetch(), formDataImpl: UndiciFormData as unknown as new () => FormData, fileName: `upload.${fileExt}` });
}

export interface ProcessAudioParams {
  supabase: SupabaseClient;
  sessionId: string;
  clientName: string;
  audio: Buffer;
  adapter: AsrAdapter;
  /** После успешной расшифровки (например, автоитоги сессии). Ошибки игнорируются. */
  onReady?: () => Promise<void>;
}

/**
 * Фоновая обработка: ASR → обезличивание → сохранение. Статус сессии: processing → ready | failed.
 * В transcript_error попадает только понятная причина, без текста записи.
 */
export async function processUploadedAudio(p: ProcessAudioParams): Promise<{ ok: boolean; reason?: string }> {
  const fail = async (reason: string) => {
    await p.supabase.from("sessions").update({ recording_status: "failed", transcript_error: reason }).eq("id", p.sessionId);
    return { ok: false, reason };
  };
  try {
    const result = await p.adapter.transcribeTrack(p.audio, "psychologist");
    const text = segmentsToLines(result.segments);
    if (!text.trim()) return await fail("В записи не удалось распознать речь. Проверьте, что файл содержит голос, и загрузите заново.");
    await saveSessionTranscript(p.supabase, p.sessionId, p.clientName, text, labelAnonymizedText);
    if (result.durationSeconds) {
      await p.supabase.from("session_transcripts").update({ duration_seconds: Math.round(result.durationSeconds) }).eq("session_id", p.sessionId);
    }
    if (p.onReady) await p.onReady().catch(() => undefined);
    return { ok: true };
  } catch (e) {
    if (e instanceof AnonymizationError) {
      return await fail("Не удалось безопасно обезличить текст записи — расшифровка остановлена. Заполните протокол вручную.");
    }
    console.error("UPLOADED_AUDIO_FAILED", p.sessionId, e instanceof Error ? e.message : "unknown");
    return await fail("Не удалось расшифровать запись. Попробуйте ещё раз или загрузите текстовую расшифровку.");
  }
}

// Одновременных расшифровок на один процесс: файл целиком лежит в памяти, ASR на CPU один.
let activeJobs = 0;
const MAX_ACTIVE_JOBS = 2;
export function tryAcquireAudioSlot(): boolean {
  if (activeJobs >= MAX_ACTIVE_JOBS) return false;
  activeJobs++;
  return true;
}
export function releaseAudioSlot(): void {
  activeJobs = Math.max(0, activeJobs - 1);
}

export type AudioUploadCheck =
  | { ok: true; file: File; ext: string }
  | { ok: false; status: number; error: string };

/** Проверка файла из multipart-формы: поле file, допустимый тип, размер. */
export function checkAudioFile(form: FormData): AudioUploadCheck {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, status: 400, error: "Файл не получен" };
  if (file.size > MAX_AUDIO_BYTES) {
    return { ok: false, status: 413, error: `Файл слишком большой (максимум ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)} МБ). Сожмите запись или разделите её на части.` };
  }
  const ext = audioExtension(file.name, file.type);
  if (!ext) return { ok: false, status: 400, error: "Неподдерживаемый формат. Подходят: mp3, m4a, wav, ogg, webm, aac, flac." };
  return { ok: true, file, ext };
}
