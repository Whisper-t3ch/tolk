// ============================================================
// Этап 3.5 (02.10.2026): адаптер ASR для НОВОГО (browser-chunk)
// пайплайна записи — принимает уже собранные assembleSessionRecording
// байты дорожки (Buffer), а не audio_url, в отличие от старого
// lib/asr.ts (тот обслуживает прежний Jibri-путь, его не трогаем —
// см. production-rollout-runbook.md, "Jibri-путь намеренно не
// трогается").
//
// Два адаптера за одним интерфейсом:
//   - createMockAsrAdapter() — детерминированная ЗАГЛУШКА без сети и
//     без реального ASR. По прямому требованию пользователя (02.10):
//     "реальные платные или внешние ASR-вызовы не включай без
//     отдельного решения; сначала тесты, mock/local adapter" — это он.
//     Позволяет прогнать ВЕСЬ пайплайн (сборка → ASR → анонимизация →
//     session_transcripts/session_transcript_segments → RAG-чанкинг →
//     SOAP) end-to-end на Preview без единого реального вызова ASR и
//     без затрат.
//   - createHttpAsrAdapter() — реальный вызов self-hosted GigaAM по
//     тому же контракту, что уже описан в lib/asr.ts ("ИЛИ
//     multipart/form-data с файлом") — здесь именно multipart-ветка,
//     потому что у нас уже есть байты в памяти, а не URL объекта в
//     Storage. НЕ вызывается нигде по умолчанию — см. выбор адаптера в
//     /api/jobs/process/route.ts (явный флаг RECORDING_ASR_ADAPTER).
// ============================================================

import { AsrError } from "@/lib/asr";
import type { Track } from "./attemptAssembly";

export interface AsrSegment {
  /** Мс от начала ЭТОЙ дорожки (не абсолютное время сессии) — см. оговорку в transcribeSession.ts про сведение по времени при нескольких попытках (reload). */
  startMs: number;
  endMs: number;
  text: string;
}

export interface AsrTrackResult {
  text: string;
  durationSeconds: number | null;
  segments: AsrSegment[];
}

export interface AsrAdapter {
  transcribeTrack(buffer: Buffer, track: Track): Promise<AsrTrackResult>;
}

/**
 * Детерминированная заглушка: нарезает буфер на синтетические окна
 * фиксированного размера и отдаёт по одному плейсхолдер-сегменту на
 * окно — ЧЕСТНО фейковый текст (не попытка угадать содержимое), но
 * с реалистичной формой ответа (несколько сегментов с нарастающим
 * временем), достаточной, чтобы протестировать склейку дорожек,
 * анонимизацию, сохранение сегментов и RAG-чанкинг не дожидаясь
 * настоящего GigaAM.
 */
export function createMockAsrAdapter(options?: { windowBytes?: number; segmentDurationMs?: number }): AsrAdapter {
  const windowBytes = options?.windowBytes ?? 4096;
  const segmentDurationMs = options?.segmentDurationMs ?? 3000;
  return {
    async transcribeTrack(buffer: Buffer, track: Track): Promise<AsrTrackResult> {
      if (buffer.length === 0) {
        return { text: "", durationSeconds: 0, segments: [] };
      }
      const windowCount = Math.max(1, Math.ceil(buffer.length / windowBytes));
      const segments: AsrSegment[] = [];
      for (let i = 0; i < windowCount; i++) {
        segments.push({
          startMs: i * segmentDurationMs,
          endMs: (i + 1) * segmentDurationMs,
          text: `[мок-транскрипт: ${track}, окно ${i + 1}/${windowCount}, ~${Math.min(windowBytes, buffer.length - i * windowBytes)} байт]`,
        });
      }
      return {
        text: segments.map(s => s.text).join(" "),
        durationSeconds: (windowCount * segmentDurationMs) / 1000,
        segments,
      };
    },
  };
}

/**
 * Реальный self-hosted GigaAM по HTTP, multipart/form-data (байты уже
 * в памяти после assembleSessionRecording — не нужно сначала грузить
 * их в Storage ради URL). НЕ вызывается без явного выбора адаптера на
 * уровне роута (RECORDING_ASR_ADAPTER=http) — см. заголовок файла.
 */
export function createHttpAsrAdapter(serviceUrl: string, options?: { authToken?: string }): AsrAdapter {
  return {
    async transcribeTrack(buffer: Buffer, track: Track): Promise<AsrTrackResult> {
      const form = new FormData();
      form.append("track", track);
      form.append("audio", new Blob([new Uint8Array(buffer)]), `${track}.webm`);

      let response: Response;
      try {
        const headers: Record<string, string> = {};
        if (options?.authToken) headers.Authorization = `Bearer ${options.authToken}`;
        response = await fetch(`${serviceUrl.replace(/\/$/, "")}/transcribe_track`, { method: "POST", body: form, headers });
      } catch (e) {
        throw new AsrError(`Не удалось связаться с ASR-сервисом: ${e instanceof Error ? e.message : String(e)}`, "request_failed");
      }
      if (!response.ok) {
        const details = await response.text().catch(() => "");
        throw new AsrError(`ASR-сервис вернул ошибку ${response.status}${details ? `: ${details}` : ""}`, "request_failed");
      }
      const data = await response.json().catch(() => null);
      const text: unknown = data?.text;
      if (typeof text !== "string") {
        throw new AsrError("ASR-сервис вернул неожиданный формат ответа (нет поля text)", "bad_response");
      }
      const rawSegments: unknown = data?.segments;
      const segments: AsrSegment[] = Array.isArray(rawSegments)
        ? rawSegments
            .filter((s): s is { start_ms: number; end_ms: number; text: string } => typeof s?.text === "string")
            .map(s => ({ startMs: Number(s.start_ms) || 0, endMs: Number(s.end_ms) || 0, text: s.text }))
        : text.trim()
          ? [{ startMs: 0, endMs: Number(data?.duration_seconds ?? 0) * 1000, text: text.trim() }]
          : [];
      const durationSeconds = typeof data?.duration_seconds === "number" ? data.duration_seconds : null;
      return { text: text.trim(), durationSeconds, segments };
    },
  };
}
