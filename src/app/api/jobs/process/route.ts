import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { processNextRecordingJob, type JobOutcome, type RecordingJobRow } from "@/lib/recording/jobQueue";
import { transcribeAssembledSession } from "@/lib/recording/transcribeSession";
import { createMockAsrAdapter, createHttpAsrAdapter, type AsrAdapter } from "@/lib/recording/asrAdapter";
import type { SessionAssemblyOk } from "@/lib/recording/attemptAssembly";

// GET/POST /api/jobs/process — Этап 3.4/3.5, воркер-контур без
// выделенной ВМ: Vercel Cron бьёт сюда по расписанию (см. vercel.json)
// GET-запросом с заголовком `Authorization: Bearer ${CRON_SECRET}` —
// документированная Vercel'ом конвенция авторизации cron-вызовов. POST
// с тем же заголовком — для ручного запуска на Preview при проверке.
//
// Расписание в vercel.json — раз в сутки (03:00 UTC), не чаще, как
// было в первой версии: тариф текущего Vercel-проекта не позволяет более
// частый cron (первый деплой с более частым расписанием провалился
// целиком, ещё до сборки — подтверждено статусом коммита на GitHub,
// редиректящим на страницу Vercel про лимиты cron-задач). Это не мешает
// функциональности — checkAuth() ниже всё равно всегда возвращает false,
// пока CRON_SECRET не задан ни в одном окружении (на 02.10.2026 это так
// везде) — воркер фактически неактивен независимо от частоты расписания,
// пока отдельно не будет принято решение его включить.
//
// За один HTTP-вызов обрабатывается РОВНО ОДНА задача (один claim).
//
// ============================================================
// ВЫБОР ASR-АДАПТЕРА — по прямому требованию пользователя (02.10):
// "реальные платные или внешние ASR-вызовы не включай без отдельного
// решения; сначала тесты, mock/local adapter". Поэтому НИЧЕГО не
// включается само по себе:
//
//   RECORDING_ASR_ADAPTER не задан (по умолчанию) — ASR не включён
//     вообще, задача помечается 'blocked' с понятной причиной. Это
//     ТЕКУЩЕЕ состояние во всех окружениях на 02.10.2026 — своей ВМ с
//     GigaAM ещё нет.
//   RECORDING_ASR_ADAPTER=mock — локальная заглушка (asrAdapter.ts),
//     без сети и без денег: позволяет прогнать весь пайплайн сборка →
//     ASR → анонимизация → session_transcripts/session_transcript_
//     segments → RAG-чанкинг → SOAP на Preview для проверки механики.
//   RECORDING_ASR_ADAPTER=http (плюс обязательно ASR_SERVICE_URL) —
//     реальный self-hosted GigaAM. Включать только отдельным,
//     осознанным решением после появления ВМ — НЕ включать просто
//     потому что ASR_SERVICE_URL когда-нибудь будет задан "попутно".
// ============================================================
function pickAdapter(): { adapter: AsrAdapter } | { blockedReason: string } {
  const mode = process.env.RECORDING_ASR_ADAPTER;
  if (mode === "mock") {
    return { adapter: createMockAsrAdapter() };
  }
  if (mode === "http") {
    const serviceUrl = process.env.ASR_SERVICE_URL;
    if (!serviceUrl) {
      return { blockedReason: "RECORDING_ASR_ADAPTER=http, но ASR_SERVICE_URL не задан — реальный ASR не может быть вызван" };
    }
    return { adapter: createHttpAsrAdapter(serviceUrl, { authToken: process.env.ASR_SERVICE_TOKEN }) };
  }
  return {
    blockedReason:
      "ASR ещё не включён ни в каком виде (RECORDING_ASR_ADAPTER не задан) — сборка записи прошла успешно, ждём либо " +
      "явного включения mock-адаптера для тестов, либо развёртывания своей ВМ с GigaAM (RECORDING_ASR_ADAPTER=http)",
  };
}

// Один вызов обрабатывает одну задачу целиком, включая ASR двух дорожек —
// без явного лимита функция может оборваться по дефолтному таймауту Vercel
// на середине транскрибации. 300 с — потолок, доступный на любом тарифе
// при Fluid Compute; если реальных записей окажется больше, воркер надо
// выносить на ВМ (схема recording_jobs это допускает).
export const maxDuration = 300;

function summarizeAssembly(assembly: SessionAssemblyOk): Record<string, { bytes: number; chunks: number }> {
  return Object.fromEntries(
    Object.entries(assembly.tracks).map(([track, data]) => [track, { bytes: data?.buffer.length ?? 0, chunks: data?.totalChunks ?? 0 }])
  );
}

async function transcribe(
  admin: ReturnType<typeof createAdminClient>,
  assembly: SessionAssemblyOk,
  job: RecordingJobRow
): Promise<JobOutcome> {
  const picked = pickAdapter();
  if ("blockedReason" in picked) {
    return { kind: "blocked", reason: picked.blockedReason, result: { assembled: summarizeAssembly(assembly) } };
  }
  return transcribeAssembledSession(admin, { sessionId: job.session_id, assembly, adapter: picked.adapter });
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
    result = await processNextRecordingJob(admin, workerId, (assembly, job) => transcribe(admin, assembly, job));
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
