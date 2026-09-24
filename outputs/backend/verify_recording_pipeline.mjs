// outputs/backend/verify_recording_pipeline.mjs
//
// Диагностика живого теста записи (24.09.2026). Запускать ИЗ СВОЕГО
// ТЕРМИНАЛА (не из песочницы агента — тот же сетевой allowlist-блок,
// что у ab_prompt_compression_test.mjs/token_usage_measure.mjs) ПОСЛЕ
// того, как проведена тестовая консультация на ветке
// recording-signed-upload-24-09.
//
// Критерий прохождения — НЕ "N chunks легли в БД" и НЕ "HTTP 200 на
// confirm". MediaRecorder.start(timeslice) не гарантирует ровный
// интервал (см. MDN), а отдельный Blob-фрагмент, кроме самого первого
// (sequence=0, несёт заголовок контейнера), не обязан воспроизводиться
// САМ ПО СЕБЕ — это подтверждённое свойство формата, не баг. Поэтому
// здесь фрагменты реально СКАЧИВАЮТСЯ, СКЛЕИВАЮТСЯ (та же логика, что
// в mic_chunk_test.html и в задокументированном remux-рецепте — см.
// claude/browser-recording-architecture-spec.md, статус п.11) и
// ПЕРЕСОБИРАЮТСЯ через ffmpeg, после чего проверяется РЕАЛЬНАЯ
// длительность (ffprobe) и наличие аудиосигнала (ffmpeg volumedetect —
// техническая метрика громкости, не прослушивание и не расшифровка
// содержания).
//
// Использует SUPABASE_SERVICE_ROLE_KEY из .env.local — обходит RLS,
// поэтому запускается ТОЛЬКО пользователем на своей машине из своего
// .env.local. Агент этот ключ никогда не видит и не запрашивает.
//
// Запуск:
//   cd tolk-demo\tolk-demo
//   node outputs/backend/verify_recording_pipeline.mjs .env.local <session_id>
//
// Требует ffmpeg/ffprobe в PATH. Если их нет — Windows:
//   winget install ffmpeg   (или choco install ffmpeg)
//
// Ничего не публикует и не печатает содержимое аудио — только числа
// (длительности, размеры, volumedetect в дБ) и файловые пути на диске.
// Скачанные аудиофайлы остаются локально в scratch-папке рядом со
// скриптом — это ваша собственная тестовая запись на вашей машине,
// скрипт их никуда не отправляет.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const [, , envPath, sessionId] = process.argv;
if (!envPath || !sessionId) {
  console.error("Использование: node verify_recording_pipeline.mjs <.env.local> <session_id>");
  process.exit(1);
}

function loadEnv(file) {
  const out = {};
  const text = readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function checkTool(name) {
  try {
    execFileSync(name, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function extensionForMimeType(mimeType) {
  const base = (mimeType || "").split(";")[0].trim().toLowerCase();
  if (base === "audio/webm") return "webm";
  if (base === "audio/mp4") return "m4a";
  if (base === "audio/ogg") return "ogg";
  return "bin";
}

async function main() {
  const env = loadEnv(envPath);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY должны быть в " + envPath);
    process.exit(1);
  }
  if (!checkTool("ffmpeg") || !checkTool("ffprobe")) {
    console.error("ffmpeg/ffprobe не найдены в PATH. Windows: winget install ffmpeg (или choco install ffmpeg), затем перезапустить терминал.");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, recording_status, recording_manifest")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) throw new Error(`sessions: ${sessionError.message}`);
  if (!session) throw new Error(`Сессия ${sessionId} не найдена`);

  const { data: chunks, error: chunksError } = await supabase
    .from("session_recording_chunks")
    .select("track, sequence, storage_key, mime_type, size_bytes, checksum, started_at_ms, duration_ms")
    .eq("session_id", sessionId)
    .order("track", { ascending: true })
    .order("sequence", { ascending: true });
  if (chunksError) throw new Error(`session_recording_chunks: ${chunksError.message}`);

  const outDir = path.join(path.dirname(envPath), "_recording_verify_" + sessionId);
  mkdirSync(outDir, { recursive: true });

  const byTrack = new Map();
  for (const chunk of chunks ?? []) {
    if (!byTrack.has(chunk.track)) byTrack.set(chunk.track, []);
    byTrack.get(chunk.track).push(chunk);
  }

  const report = {
    sessionId,
    recordingStatus: session.recording_status,
    manifestValidation: session.recording_manifest?.validation ?? null,
    tracks: {},
  };

  for (const track of ["psychologist", "client"]) {
    const list = byTrack.get(track) ?? [];
    const trackReport = {
      chunkCount: list.length,
      sequenceGaps: [],
      dbTotalBytes: 0,
      dbTotalDurationMs: 0,
      assembled: false,
      measuredDurationSec: null,
      volumeDetect: null,
      error: null,
    };
    report.tracks[track] = trackReport;

    if (list.length === 0) {
      trackReport.error = "нет ни одного фрагмента в БД для этой дорожки";
      continue;
    }

    for (let i = 0; i < list.length; i++) {
      if (list[i].sequence !== i) trackReport.sequenceGaps.push({ expected: i, found: list[i].sequence });
      trackReport.dbTotalBytes += list[i].size_bytes ?? 0;
      trackReport.dbTotalDurationMs += list[i].duration_ms ?? 0;
    }

    // Скачиваем реальные байты каждого фрагмента (в порядке sequence) и
    // склеиваем — та же логика, что и "cat chunk_000000.webm
    // chunk_000001.webm ... > raw.webm" из architecture-spec, статус
    // п.11, просто программно вместо shell cat.
    const buffers = [];
    let downloadError = null;
    for (const chunk of list) {
      const { data: blob, error } = await supabase.storage.from("session-recordings").download(chunk.storage_key);
      if (error) {
        downloadError = `не удалось скачать ${chunk.storage_key}: ${error.message}`;
        break;
      }
      buffers.push(Buffer.from(await blob.arrayBuffer()));
    }
    if (downloadError) {
      trackReport.error = downloadError;
      continue;
    }

    const ext = extensionForMimeType(list[0].mime_type);
    const rawPath = path.join(outDir, `${track}_raw.${ext}`);
    const fixedPath = path.join(outDir, `${track}_fixed.${ext}`);
    writeFileSync(rawPath, Buffer.concat(buffers));

    try {
      const remuxArgs =
        ext === "m4a"
          ? ["-y", "-i", rawPath, "-c", "copy", "-movflags", "+faststart", fixedPath]
          : ["-y", "-i", rawPath, "-c", "copy", "-cues_to_front", "1", fixedPath];
      execFileSync("ffmpeg", remuxArgs, { stdio: "pipe" });
      trackReport.assembled = true;
    } catch (e) {
      trackReport.error = `ffmpeg remux не удался: ${e.message}`;
      continue;
    }

    try {
      const probeOut = execFileSync(
        "ffprobe",
        ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", fixedPath],
        { encoding: "utf8" }
      );
      trackReport.measuredDurationSec = parseFloat(probeOut.trim());
    } catch (e) {
      trackReport.error = (trackReport.error ? trackReport.error + "; " : "") + `ffprobe не удался: ${e.message}`;
    }

    {
      // volumedetect — техническая метрика (mean/max громкость в дБ),
      // не прослушивание и не расшифровка содержания. Не результат
      // "качественный" сам по себе, но отличает "почти тишина, дорожки
      // фактически нет" от "есть сигнал сопоставимого с речью уровня".
      // ffmpeg пишет статистику фильтра в stderr и штатно завершается
      // кодом 0 при муксе в null — используем spawnSync, чтобы читать
      // stderr независимо от кода возврата, а не полагаться на throw.
      const nullTarget = process.platform === "win32" ? "NUL" : "/dev/null";
      const result = spawnSync("ffmpeg", ["-i", fixedPath, "-af", "volumedetect", "-f", "null", nullTarget], {
        encoding: "utf8",
      });
      const stderr = result.stderr ?? "";
      const meanMatch = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
      const maxMatch = stderr.match(/max_volume:\s*(-?[\d.]+)\s*dB/);
      if (meanMatch || maxMatch) {
        trackReport.volumeDetect = {
          meanVolumeDb: meanMatch ? parseFloat(meanMatch[1]) : null,
          maxVolumeDb: maxMatch ? parseFloat(maxMatch[1]) : null,
        };
      } else {
        trackReport.error = (trackReport.error ? trackReport.error + "; " : "") + "volumedetect: не удалось распознать вывод ffmpeg";
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
  console.log(`\nСобранные файлы (если понадобится прослушать самостоятельно) — в ${outDir}`);
}

main().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
