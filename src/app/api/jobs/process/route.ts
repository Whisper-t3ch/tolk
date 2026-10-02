import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { processNextRecordingJob, type JobOutcome } from "@/lib/recording/jobQueue";
import { checkAsrEnv } from "@/lib/asr";
import type { SessionAssemblyOk } from "@/lib/recording/attemptAssembly";

// GET/POST /api/jobs/process — Этап 3.4, воркер-контур без выделенной
// ВМ: Vercel Cron бьёт сюда по расписанию (см. vercel.json) GET-
// запросом с заголовком `Authorization: Bearer ${CRON_SECRET}` — это
// документированная Vercel'ом конвенция авторизации cron-вызовов
// (переменная CRON_SECRET), не наш собственный секрет "с нуля". POST с
// тем же заголовком — для ручного запуска на Preview при проверке.
//
// За один HTTP-вызов обрабатывается РОВНО ОДНА задача (один claim) —
// проще держать каждый вызов коротким и укладываться в лимит времени
// Vercel-функции, чем рисковать таймаутом на пачке тяжёлых сессий;
// расписание в vercel.json достаточно частое, чтобы очередь не
// накапливалась заметно при ожидаемой нагрузке (15-20 сессий/день).
//
// ============================================================
// transcribeStub() — ЗАГЛУШКА (Этап 3.5, следующая ветка, подставит
// сюда настоящий вызов GigaAM + запись в session_transcripts +
// анонимизацию + триггер SOAP). На 02.10.2026 ASR_SERVICE_URL не
// задан НИ В ОДНОМ окружении (своей ВМ ещё нет) — единственный
// честный исход прямо сейчас — 'blocked' с понятной причиной, а не
// притворяться, что транскрипция произошла, когда её не было.
// ============================================================
async function transcribeStub(assembly: SessionAssemblyOk): Promise<JobOutcome> {
  const tracksSummary = Object.fromEntries(
    Object.entries(assembly.tracks).map(([track, data]) => [
      track,
      { bytes: data?.buffer.length ?? 0, chunks: data?.totalChunks ?? 0 },
    ])
  );
  const asrStatus = checkAsrEnv();
  if (!asrStatus.configured) {
    return {
      kind: "blocked",
      reason: "ASR (GigaAM) ещё не настроен (ASR_SERVICE_URL не задан) — сборка прошла успешно, ждём инфраструктуру",
      result: { assembled: tracksSummary },
    };
  }
  return {
    kind: "blocked",
    reason: "ASR_SERVICE_URL настроен, но вызов GigaAM для нового browser-pipeline ещё не реализован (Этап 3.5)",
    result: { assembled: tracksSummary },
  };
}

function checkAuth(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const admin = createAdminClient();
  const workerId = `vercel-${randomUUID()}`;

  let result;
  try {
    result = await processNextRecordingJob(admin, workerId, transcribeStub);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  if (!result) {
    return NextResponse.json({ ok: true, processed: false });
  }
  return NextResponse.json({ ok: true, processed: true, jobId: result.jobId, outcome: result.outcome });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
