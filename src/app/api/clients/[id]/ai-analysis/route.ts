import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkAssistantLimit, consumeAssistantLimit, limitExceededResponse } from "@/lib/assistantLimits";
import { AiAnalysisError, buildOverview, buildSessionAnalysis, buildTestAnalysis, type AnalysisKind } from "@/lib/prompts/aiAnalysis";

// GET /api/clients/[id]/ai-analysis — все сохранённые ИИ-анализы клиента (свежие первыми).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { data, error } = await supabase
    .from("client_ai_analyses")
    .select("id, kind, ref, content, score, created_at, auto, edited_at")
    .eq("client_id", clientId)
    .eq("psychologist_id", user.id)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ analyses: data ?? [] });
}

// POST /api/clients/[id]/ai-analysis { kind: "overview" | "test" | "session", ref?: string }
// Обзор клиента и анализ теста стоят 1 запрос из лимита ассистента, резюме сессии — бесплатно; списывается только после успешного ответа модели.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  let body: { kind?: string; ref?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }
  const kind = body.kind as AnalysisKind | undefined;
  if (kind !== "overview" && kind !== "test" && kind !== "session") {
    return NextResponse.json({ error: "kind: overview, test или session" }, { status: 400 });
  }
  if (kind !== "overview" && !body.ref) return NextResponse.json({ error: "Укажите ref (тест или сессию)" }, { status: 400 });

  // Резюме сессии бесплатное (не списывает запросы ассистента), но не безлимитное: не более 5 пересборок
  // одной сессии за сутки — защита от случайных и автоматических повторов. Остальные анализы — 1 запрос.
  const isFree = kind === "session";
  if (isFree) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("client_ai_analyses")
      .select("id", { count: "exact", head: true })
      .eq("psychologist_id", user.id)
      .eq("kind", "session")
      .eq("ref", body.ref as string)
      .gte("created_at", since);
    if ((count ?? 0) >= 5) {
      return NextResponse.json({ error: "Резюме этой сессии уже обновлялось 5 раз за сутки — попробуйте завтра." }, { status: 429 });
    }
  } else {
    const limitCheck = await checkAssistantLimit(supabase, user.id, "aiAnalysis");
    if (!limitCheck.allowed) {
      return NextResponse.json(limitExceededResponse(limitCheck.limit, limitCheck), { status: 429 });
    }
  }

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, request, approach")
    .eq("id", clientId)
    .eq("psychologist_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (clientError) return NextResponse.json({ error: clientError.message }, { status: 500 });
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 });

  let built;
  try {
    built =
      kind === "overview" ? await buildOverview(supabase, client)
      : kind === "test" ? await buildTestAnalysis(supabase, client, body.ref as string)
      : await buildSessionAnalysis(supabase, client, body.ref as string);
  } catch (e) {
    if (e instanceof AiAnalysisError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("AI_ANALYSIS_FAILED", kind, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Не удалось получить анализ. Запрос не списан." }, { status: 502 });
  }

  const { data: saved, error: saveError } = await supabase
    .from("client_ai_analyses")
    .insert({
      psychologist_id: user.id,
      client_id: clientId,
      kind,
      ref: kind === "overview" ? null : body.ref,
      content: built.content,
      score: built.score,
    })
    .select("id, kind, ref, content, score, created_at, auto, edited_at")
    .single();
  if (saveError) {
    console.error("AI_ANALYSIS_SAVE_FAILED", saveError.message);
    return NextResponse.json({ error: "Анализ получен, но не сохранился. Запрос не списан." }, { status: 500 });
  }

  if (!isFree) await consumeAssistantLimit(supabase, user.id, "aiAnalysis");
  return NextResponse.json({ analysis: saved });
}
