import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkYandexGptEnv, yandexGptCompleteJson, YandexGptError } from "@/lib/yandexgpt";
import { checkAssistantLimit, consumeAssistantLimit, limitExceededResponse } from "@/lib/assistantLimits";
import {
  PERIOD_SUMMARY_SYSTEM_PROMPT,
  buildPeriodSummaryUserMessage,
  formatPeriodSummaryAsText,
  type PeriodSummaryResult,
} from "@/lib/prompts/periodSummary";

// POST /api/clients/[id]/summary
// Body: { session_ids: string[], period_label?: string }
// Тяжёлый запрос — списывает 3 из лимита ассистента.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const envStatus = checkYandexGptEnv();
  if (!envStatus.configured) {
    return NextResponse.json(
      { error: `YandexGPT не настроен. Добавьте ключи в .env: ${envStatus.missing.join(", ")}` },
      { status: 503 }
    );
  }

  const { id: clientId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { session_ids?: string[]; period_label?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const sessionIds = body.session_ids;
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
    return NextResponse.json({ error: "Укажите session_ids (непустой массив)" }, { status: 400 });
  }

  // Проверяем лимит ДО дорогого вызова к LLM.
  const limitCheck = await checkAssistantLimit(supabase, user.id, "periodSummary");
  if (!limitCheck.allowed) {
    return NextResponse.json(limitExceededResponse(limitCheck.limit), { status: 429 });
  }

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .maybeSingle();
  if (clientError) {
    return NextResponse.json({ error: clientError.message }, { status: 500 });
  }
  if (!client) {
    return NextResponse.json({ error: "Клиент не найден" }, { status: 404 });
  }

  const { data: sessions, error: sessionsError } = await supabase
    .from("sessions")
    .select("id, scheduled_at")
    .eq("client_id", clientId)
    .in("id", sessionIds)
    .order("scheduled_at", { ascending: true });
  if (sessionsError) {
    return NextResponse.json({ error: sessionsError.message }, { status: 500 });
  }
  if (!sessions || sessions.length === 0) {
    return NextResponse.json({ error: "Ни одна из указанных сессий не найдена у этого клиента" }, { status: 404 });
  }

  const foundIds = sessions.map(s => s.id as string);
  const { data: transcripts, error: transcriptsError } = await supabase
    .from("session_transcripts")
    .select("session_id, raw_text, created_at")
    .in("session_id", foundIds)
    .order("created_at", { ascending: false });
  if (transcriptsError) {
    return NextResponse.json({ error: transcriptsError.message }, { status: 500 });
  }

  const latestBySession = new Map<string, string>();
  for (const t of transcripts ?? []) {
    const sid = t.session_id as string;
    if (!latestBySession.has(sid) && t.raw_text) {
      latestBySession.set(sid, t.raw_text as string);
    }
  }

  const sections: string[] = [];
  let sessionNumber = 0;
  for (const session of sessions) {
    sessionNumber += 1;
    const text = latestBySession.get(session.id as string);
    if (!text) continue;
    const date = new Date(session.scheduled_at as string).toISOString().slice(0, 10);
    sections.push(`=== Сессия №${sessionNumber} от ${date} ===\n${text}`);
  }

  if (sections.length === 0) {
    return NextResponse.json({ error: "Ни для одной из выбранных сессий транскрипт не готов" }, { status: 404 });
  }

  const dateStart = new Date(sessions[0].scheduled_at as string).toISOString().slice(0, 10);
  const dateEnd = new Date(sessions[sessions.length - 1].scheduled_at as string).toISOString().slice(0, 10);

  let result: PeriodSummaryResult;
  try {
    result = await yandexGptCompleteJson<PeriodSummaryResult>([
      { role: "system", text: PERIOD_SUMMARY_SYSTEM_PROMPT },
      {
        role: "user",
        text: buildPeriodSummaryUserMessage({
          sessionsCount: sections.length,
          dateStart,
          dateEnd,
          transcripts: sections.join("\n\n"),
        }),
      },
    ]);
  } catch (e) {
    const message = e instanceof YandexGptError ? e.message : "Не удалось сгенерировать срез";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const summaryText = formatPeriodSummaryAsText(result);

  const { data: saved, error: saveError } = await supabase
    .from("period_summaries")
    .insert({
      psychologist_id: user.id,
      client_id: clientId,
      period_start: dateStart,
      period_end: dateEnd,
      sessions_count: sections.length,
      summary: summaryText,
    })
    .select("id, period_start, period_end, sessions_count, summary, created_at")
    .single();

  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  // Списываем лимит только после успешного вызова LLM и сохранения.
  await consumeAssistantLimit(supabase, user.id, "periodSummary");

  return NextResponse.json({
    summary: summaryText,
    structured: result,
    period_summary_id: saved.id,
    period_start: saved.period_start,
    period_end: saved.period_end,
    sessions_count: saved.sessions_count,
  });
}
