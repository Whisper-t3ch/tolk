// outputs/backend/verify_recording_pipeline.mjs
//
// Диагностика живого теста записи (24.09.2026, обновлено под
// recording_attempt_id — см. migration_038). Запускать ИЗ СВОЕГО
// ТЕРМИНАЛА (не из песочницы агента) ПОСЛЕ того, как проведена
// тестовая консультация на ветке recording-signed-upload-24-09.
//
// Критерий прохождения — НЕ "N chunks легли в БД" и НЕ "HTTP 200 на
// confirm". MediaRecorder.start(timeslice) не гарантирует ровный
// интервал (см. MDN), а отдельный Blob-фрагмент, кроме самого первого
// (sequence=0, несёт заголовок контейнера), не обязан воспроизводиться
// САМ ПО СЕБЕ. Поэтому фрагменты реально СКАЧИВАЮТСЯ, СКЛЕИВАЮТСЯ и
// ПЕРЕСОБИРАЮТСЯ через ffmpeg, после чего проверяется РЕАЛЬНАЯ
// длительность (ffprobe) и наличие аудиосигнала (ffmpeg volumedetect —
// техническая метрика громкости, не прослушивание и не расшифровка
// содержания — правильность голоса на дорожке проверяется отдельно
// тестовыми фразами, не этим скриптом).
//
// АУДИТ БЕЗОПАСНОСТИ/ПОБОЧНЫХ ЭФФЕКТОВ (24.09, по прямому требованию
// перед первым запуском пользователем):
//   - Скрипт использует SUPABASE_SERVICE_ROLE_KEY из .env.local —
//     обходит RLS, поэтому запускается ТОЛЬКО пользователем на своей
//     машине из своего .env.local. Агент этот ключ никогда не видит.
//   - Скрипт НЕ печатает service-role key, НЕ печатает никакой
//     signed/download URL (Supabase .download() возвращает Blob
//     напрямую, а не временную ссылку — скрипт саму ссылку никогда не
//     запрашивает и не видит) и НЕ печатает содержимое аудио.
//   - В итоговый JSON попадают только числа (длительности, размеры,
//     число фрагментов, volumedetect в дБ), статусы/id попытки записи
//     (recording_attempt_id — не секрет, это внутренний идентификатор
//     без доступа сам по себе) и текстовые описания технических ошибок.
//   - ИСПРАВЛЕНО 24.09: раньше собранные/расшифрованные аудиофайлы
//     писались в папку РЯДОМ С .env.local — а .env.local лежит в корне
//     репозитория, то есть файлы попадали ВНУТРЬ git-рабочего дерева и
//     рисковали случайно попасть в коммит. Теперь папка создаётся
//     через os.tmpdir() (системная временная директория ОС, вне
//     репозитория в принципе) — путь печатается в консоль, но сам
//     путь никогда не находится внутри tolk-demo/tolk-demo. Отдельно,
//     на случай нестандартной настройки TMPDIR на конкретной машине,
//     ниже есть защитная проверка: если вычисленный путь всё же
//     оказался внутри текущего git-репозитория, скрипт останавливается
//     с ошибкой вместо того, чтобы молча писать туда файлы.
//
// Использует SUPABASE_SERVICE_ROLE_KEY из .env.local.
//
// Запуск:
//   cd tolk-demo\tolk-demo
//   node outputs/backend/verify_recording_pipeline.mjs .env.local <session_id>
//
// Опционально третий аргумент — конкретный recording_attempt_id, если
// на сессии было НЕСКОЛЬКО попыток записи (например, психолог
// перезагружал вкладку) и нужно проверить не последнюю, а конкретную:
//   node outputs/backend/verify_recording_pipeline.mjs .env.local <session_id> <attempt_id>
// Без третьего аргумента скрипт берёт САМУЮ ПОСЛЕДНЮЮ (по started_at)
// попытку записи этой сессии и явно предупреждает в отчёте, если у
// сессии есть ЕЩЁ попытки, которые в проверку не попали — это открытый
// вопрос (что делать с несколькими попытками на одну консультацию),
// см. claude/browser-recording-architecture-spec.md.
//
// Требует ffmpeg/ffprobe в PATH. Если их нет — Windows:
//   winget install ffmpeg   (или choco install ffmpeg)

import { readFileSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { createClient } from "@supabase/supabase-js";

const [, scriptPath, envPath, sessionId, explicitAttemptId] = process.argv;
if (!envPath || !sessionId) {
  console.error("Использование: node verify_recording_pipeline.mjs <.env.local> <session_id> [attempt_id]");
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

/**
 * Папка для собранных/расшифрованных аудиофайлов — ВСЕГДА вне
 * git-репозитория (см. аудит в заголовке файла). os.tmpdir() — это
 * системная временная директория ОС (на Windows обычно
 * %LOCALAPPDATA%\Temp), никогда не внутри рабочего дерева репозитория
 * по построению; защитная проверка ниже — на случай нестандартной
 * настройки TMPDIR/TEMP на конкретной машине.
 */
function resolveOutDir(envFilePath, sessionIdForDir) {
  const outDir = path.join(os.tmpdir(), "tolk_recording_verify_" + sessionIdForDir);
  mkdirSync(outDir, { recursive: true });

  const repoRoot = path.resolve(path.dirname(envFilePath));
  const resolvedOutDir = realpathSync(outDir);
  const resolvedRepoRoot = realpathSync(repoRoot);
  if (resolvedOutDir === resolvedRepoRoot || resolvedOutDir.startsWith(resolvedRepoRoot + path.sep)) {
    throw new Error(
      `Вычисленная временная папка (${resolvedOutDir}) оказалась ВНУТРИ репозитория (${resolvedRepoRoot}) — ` +
        `остановлено намеренно, чтобы не писать аудио в git-дерево. Проверьте переменные окружения TMPDIR/TEMP/TMP.`
    );
  }
  return outDir;
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

  const { data: attempts, error: attemptsError } = await supabase
    .from("recording_attempts")
    .select("id, status, started_at, ended_at")
    .eq("session_id", sessionId)
    .order("started_at", { ascending: false });
  if (attemptsError) throw new Error(`recording_attempts: ${attemptsError.message}`);
  if (!attempts || attempts.length === 0) {
    throw new Error(
      `Для сессии ${sessionId} нет ни одной записи в recording_attempts — запись либо не запускалась, ` +
        `либо ещё используется старая (до 24.09) версия кода без attempt_id.`
    );
  }

  const attemptId = explicitAttemptId || attempts[0].id;
  const selectedAttempt = attempts.find(a => a.id === attemptId);
  if (!selectedAttempt) {
    throw new Error(`Попытка ${attemptId} не найдена среди попыток записи сессии ${sessionId}`);
  }
  const otherAttempts = attempts.filter(a => a.id !== attemptId);

  const { data: chunks, error: chunksError } = await supabase
    .from("session_recording_chunks")
    .select("track, sequence, storage_key, mime_type, size_bytes, checksum, started_at_ms, duration_ms")
    .eq("session_id", sessionId)
    .eq("recording_attempt_id", attemptId)
    .order("track", { ascending: true })
    .order("sequence", { ascending: true });
  if (chunksError) throw new Error(`session_recording_chunks: ${chunksError.message}`);

  const outDir = resolveOutDir(envPath, sessionId);

  const byTrack = new Map();
  for (const chunk of chunks ?? []) {
    if (!byTrack.has(chunk.track)) byTrack.set(chunk.track, []);
    byTrack.get(chunk.track).push(chunk);
  }

  const report = {
    sessionId,
    recordingStatus: session.recording_status,
    manifestValidation: session.recording_manifest?.validation ?? null,
    verifiedAttempt: {
      id: selectedAttempt.id,
      status: selectedAttempt.status,
      startedAt: selectedAttempt.started_at,
      endedAt: selectedAttempt.ended_at,
    },
    // Если тут не пусто — на сессии было больше одной попытки записи
    // (например, психолог перезагрузил вкладку посреди консультации).
    // Эта проверка смотрит ТОЛЬКО verifiedAttempt выше; остальные
    // попытки не собираются и не оцениваются этим запуском — открытый
    // вопрос, см. architecture-spec.
    otherAttemptsNotChecked: otherAttempts.map(a => ({ id: a.id, status: a.status, startedAt: a.started_at })),
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
      trackReport.error = "нет ни одного фрагмента в БД для этой дорожки в этой попытке записи";
      continue;
    }

    for (let i = 0; i < list.length; i++) {
      if (list[i].sequence !== i) trackReport.sequenceGaps.push({ expected: i, found: list[i].sequence });
      trackReport.dbTotalBytes += list[i].size_bytes ?? 0;
      trackReport.dbTotalDurationMs += list[i].duration_ms ?? 0;
    }

    const buffers = [];
    let downloadError = null;
    for (const chunk of list) {
      const { data: blob, error } = await supabase.storage.from("session-recordings").download(chunk.storage_key);
      if (error) {
        downloadError = `не удалось скачать фрагмент #${chunk.sequence}: ${error.message}`;
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
  console.log(`Эта папка ВНЕ репозитория (системная временная директория ОС) — в git не попадёт.`);
}

main().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
