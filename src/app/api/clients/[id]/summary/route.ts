import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkYandexGptEnv } from "@/lib/yandexgpt";
import { checkAssistantLimit, consumeAssistantLimit, limitExceededResponse } from "@/lib/assistantLimits";
import { buildAnonymizedPeriodSummary, PeriodSummaryError } from "@/lib/prompts/periodSummary";

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
    .eq("psychologist_id", user.id)
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

  let periodSummary;
  try {
    periodSummary = await buildAnonymizedPeriodSummary(
      supabase,
      sessions.map(s => ({ id: s.id as string, scheduled_at: s.scheduled_at as string })),
      client.name
    );
  } catch (e) {
    const message = e instanceof PeriodSummaryError ? e.message : "Не удалось сгенерировать срез";
    const status = e instanceof PeriodSummaryError && message.includes("транскрипт") ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }

  const { summaryText, structured, sectionsCount, dateStart, dateEnd } = periodSummary;

  const { data: saved, error: saveError } = await supabase
    .from("period_summaries")
    .insert({
      psychologist_id: user.id,
      client_id: clientId,
      period_start: dateStart,
      period_end: dateEnd,
      sessions_count: sectionsCount,
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
    structured,
    period_summary_id: saved.id,
    period_start: saved.period_start,
    period_end: saved.period_end,
    sessions_count: saved.sessions_count,
  });
}
