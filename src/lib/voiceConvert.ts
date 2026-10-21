import { spawn } from "node:child_process";

/**
 * Перекодирует запись из браузера (webm/opus на Chrome и Firefox, mp4/aac на Safari)
 * в ogg/opus — формат голосовых сообщений Telegram. Нужен ffmpeg в образе (см. Dockerfile).
 * Если ffmpeg недоступен, возвращает null — вызывающий код пошлёт исходный файл как есть.
 */
export function convertToOggOpus(input: Buffer, timeoutMs = 30_000): Promise<Buffer | null> {
  return new Promise(resolve => {
    let proc;
    try {
      proc = spawn(
        "ffmpeg",
        ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "32k", "-f", "ogg", "pipe:1"],
        { stdio: ["pipe", "pipe", "pipe"] }
      );
    } catch {
      resolve(null);
      return;
    }
    const out: Buffer[] = [];
    let done = false;
    const finish = (v: Buffer | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      finish(null);
    }, timeoutMs);
    proc.stdout.on("data", d => out.push(d));
    proc.on("error", () => finish(null)); // ENOENT — ffmpeg не установлен
    proc.on("close", code => {
      const buf = Buffer.concat(out);
      finish(code === 0 && buf.length > 0 ? buf : null);
    });
    proc.stdin.on("error", () => { /* ffmpeg мог закрыться раньше — результат решает close */ });
    proc.stdin.end(input);
  });
}
