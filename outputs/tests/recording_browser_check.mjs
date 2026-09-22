// ============================================================
// Проверка браузерного рекордера в реальном Chromium.
//
// Зачем отдельный скрипт, а не обычный юнит-тест: MediaRecorder,
// getUserMedia, IndexedDB и crypto.subtle не существуют в Node — код
// записи можно проверить только в браузере. Скрипт поднимает Chromium
// с поддельным микрофоном, собирает src/lib/recording через esbuild и
// прогоняет рекордер на двух синтетических потоках, изображающих
// дорожку психолога и дорожку клиента.
//
// Это закрывает Этап 1 («технический прототип») в части, не требующей
// видеосервера: подтверждает, что две дорожки пишутся независимо,
// нарезаются на фрагменты со сквозной нумерацией и дают непустые Blob.
// Реальные local/remote треки Jitsi подставляются на их место без
// изменений в рекордере — он принимает готовый MediaStream.
//
// Запуск:  node outputs/tests/recording_browser_check.mjs
// ============================================================

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import esbuild from "esbuild";
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ------------------------------------------------------------
// 1. Сборка модуля записи в один браузерный бандл
// ------------------------------------------------------------
const entry = `
  export { SessionRecorder } from "${repoRoot}/src/lib/recording/sessionRecorder.ts";
  export { runPreflight } from "${repoRoot}/src/lib/recording/preflight.ts";
  export { selectMimeType, listSupportedMimeTypes } from "${repoRoot}/src/lib/recording/mime.ts";
`;

const built = await esbuild.build({
  stdin: { contents: entry, resolveDir: repoRoot, loader: "ts" },
  bundle: true,
  format: "iife",
  globalName: "TolkRecording",
  target: "chrome120",
  write: false,
});
const bundle = built.outputFiles[0].text;

// ------------------------------------------------------------
// 2. Страница на localhost — secure context нужен для crypto.subtle
//    и getUserMedia (about:blank не подошёл бы).
// ------------------------------------------------------------
const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><title>recorder check</title><script>${bundle}</script>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({
  args: [
    "--use-fake-device-for-media-capture",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

try {
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();
  page.on("pageerror", e => console.error("  page error:", e.message));
  await page.goto(origin);

  // ----------------------------------------------------------
  // Тест 1. Preflight на устройстве с поддельным микрофоном
  // ----------------------------------------------------------
  // В этом контейнере нет аудиоустройств вообще: getUserMedia падает с
  // NotFoundError при любых флагах Chromium (--use-fake-device-for-media-capture
  // и --use-file-for-fake-audio-capture проверены, enumerateDevices пуст).
  // Поэтому проверяем две вещи по отдельности: (1) всю цепочку preflight
  // на подставленном потоке и (2) корректную деградацию, когда микрофона
  // действительно нет.
  console.log("\nPreflight — полная цепочка на подставленном потоке");
  const preflight = await page.evaluate(async () => {
    const ctx = new AudioContext();
    await ctx.resume();
    const result = await window.TolkRecording.runPreflight({
      testRecordingMs: 400,
      getMicrophoneStream: async () => {
        const oscillator = ctx.createOscillator();
        const destination = ctx.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        return destination.stream;
      },
      // Запас квоты в headless-профиле меньше продового порога —
      // проверяем саму механику, а не объём диска CI.
      minStorageBytes: 1024,
    });
    ctx.close();
    return {
      verdict: result.verdict,
      mimeType: result.mimeType,
      storageRemainingBytes: result.storageRemainingBytes,
      checks: result.checks.map(c => `${c.id}:${c.status}`),
    };
  });
  check("вердикт allow", preflight.verdict === "allow", `${preflight.verdict} [${preflight.checks.join(", ")}]`);
  check("формат выбран в runtime", Boolean(preflight.mimeType), preflight.mimeType ?? "нет");
  check("тестовая запись прошла", preflight.checks.includes("test_recording:pass"));
  check("локальный буфер работает", preflight.checks.includes("indexed_db:pass"));
  check("квота хранилища прочитана", preflight.checks.includes("storage_quota:pass"));
  check("WebRTC доступен", preflight.checks.includes("webrtc:pass"));

  console.log("\nPreflight — деградация без микрофона");
  const noMic = await page.evaluate(async () => {
    const result = await window.TolkRecording.runPreflight({ testRecordingMs: 200 });
    return {
      verdict: result.verdict,
      checks: result.checks.map(c => `${c.id}:${c.status}`),
    };
  });
  check("вердикт microphone_blocked", noMic.verdict === "microphone_blocked", noMic.verdict);
  check("проверки после микрофона пропущены", noMic.checks.includes("test_recording:skipped"));

  // ----------------------------------------------------------
  // Тест 2. Две дорожки пишутся одновременно и независимо.
  //
  // Синтетические потоки: два осциллятора разной частоты через
  // MediaStreamAudioDestinationNode. Для рекордера это обычные
  // MediaStream — ровно то, что придёт из lib-jitsi-meet через
  // getOriginalStream() для локальной и удалённой дорожки.
  // ----------------------------------------------------------
  console.log("\nЗапись двух дорожек");
  const run = await page.evaluate(async () => {
    const ctx = new AudioContext();
    await ctx.resume();
    const makeStream = frequency => {
      const oscillator = ctx.createOscillator();
      oscillator.frequency.value = frequency;
      const destination = ctx.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      return destination.stream;
    };

    const chunks = [];
    const recorder = new window.TolkRecording.SessionRecorder({
      sessionId: "test-session",
      localStream: makeStream(440), // психолог
      remoteStream: makeStream(880), // клиент
      timesliceMs: 300,
      onChunk: chunk =>
        chunks.push({
          role: chunk.role,
          sequence: chunk.sequence,
          size: chunk.size,
          checksum: chunk.checksum,
          mimeType: chunk.mimeType,
          startedAtMs: chunk.startedAtMs,
          durationMs: chunk.durationMs,
        }),
    });

    recorder.start();
    const statusDuringCall = recorder.getStatus();
    await new Promise(r => setTimeout(r, 2200));
    const manifest = await recorder.stop();
    ctx.close();
    return { chunks, manifest, statusDuringCall };
  });

  const byRole = role => run.chunks.filter(c => c.role === role).sort((a, b) => a.sequence - b.sequence);
  const psychologist = byRole("psychologist");
  const client = byRole("client");

  check("дорожка психолога пишется", psychologist.length >= 3, `${psychologist.length} фрагментов`);
  check("дорожка клиента пишется", client.length >= 3, `${client.length} фрагментов`);
  check("обе дорожки идут одновременно", run.statusDuringCall.tracks.length === 2 && run.statusDuringCall.recording);
  check("клиент подключён", run.statusDuringCall.awaitingClient === false);

  for (const [role, list] of [["психолог", psychologist], ["клиент", client]]) {
    const contiguous = list.every((c, i) => c.sequence === i);
    check(`нумерация без дыр (${role})`, contiguous, list.map(c => c.sequence).join(","));
    check(`все фрагменты непустые (${role})`, list.every(c => c.size > 0), `мин ${Math.min(...list.map(c => c.size))} байт`);
    check(
      `checksum посчитан (${role})`,
      list.every(c => /^sha256:[0-9a-f]{64}$/.test(c.checksum))
    );
    const monotonic = list.every((c, i) => i === 0 || c.startedAtMs >= list[i - 1].startedAtMs);
    check(`тайминги монотонны (${role})`, monotonic);
  }

  // Дорожки должны быть РАЗНЫМИ — иначе мы пишем один и тот же звук дважды
  // и раздельные дорожки не дают ничего. Разные частоты → разные байты.
  const sameData = psychologist[0] && client[0] && psychologist[0].checksum === client[0].checksum;
  check("дорожки содержат разный звук", !sameData);

  // ----------------------------------------------------------
  // Тест 3. Manifest
  // ----------------------------------------------------------
  console.log("\nManifest");
  const manifest = run.manifest;
  check("manifest описывает обе дорожки", manifest.tracks.length === 2, manifest.tracks.map(t => t.role).join(", "));
  for (const track of manifest.tracks) {
    const recorded = byRole(track.role);
    check(
      `${track.role}: счётчик совпадает с фактом`,
      track.chunkCount === recorded.length && track.lastSequence === recorded.length - 1,
      `manifest ${track.chunkCount}, фактически ${recorded.length}`
    );
    check(`${track.role}: дорожка остановлена штатно`, track.state === "stopped", track.state);
    check(`${track.role}: длительность ненулевая`, track.totalDurationMs > 0, `${track.totalDurationMs} мс`);
  }
  const [a, b] = manifest.tracks.map(t => t.totalDurationMs);
  check("дорожки не разъехались по длительности", Math.abs(a - b) < 1000, `разница ${Math.abs(a - b)} мс`);
} finally {
  await browser.close();
  server.close();
}

console.log(
  failures.length === 0
    ? "\nВсе проверки прошли.\n"
    : `\nПровалено ${failures.length}: ${failures.join("; ")}\n`
);
process.exit(failures.length === 0 ? 0 : 1);
