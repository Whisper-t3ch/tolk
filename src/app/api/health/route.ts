// Лёгкая проверка живости процесса: не ходит ни в БД, ни во внешние сервисы,
// секретов не отдаёт. Используется Docker healthcheck и Caddy (self-hosted
// сборка рядом с ASR) и внешним мониторингом/замерами TTFB.
export const dynamic = "force-dynamic";

const STARTED_AT = Date.now();

export function GET() {
  return Response.json(
    {
      ok: true,
      uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
      commit: process.env.GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
