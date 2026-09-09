import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkYandexGptEnv, yandexGptCompleteJson, YandexGptError } from "@/lib/yandexgpt";
import {
  buildSoapUserMessage,
  selectSoapSystemPrompt,
  type SoapResult,
} from "@/lib/prompts/soap";

// POST /api/sessions/[id]/soap/generate
// Body (опционально): { template_id?: string } — id материала из
// knowledge_base (source_type=protocol), выбранного психологом на
// странице протокола. Если указан, его текст передаётся модели как
// ориентир структуры/акцентов для блоков s/o/a/p (см. lib/prompts/soap.ts)
// и сохраняется в soap_notes.protocol_template_id — без него используется
// базовый формат по умолчанию, как раньше.
//
// Генерирует протокол сессии через YandexGPT Pro из транскрипта (если
// готов) и краткого контекста предыдущих сессий, сохраняет результат
// в soap_notes (ai_generated: true) и возвращает его — страница
// /session/[id]/soap подставляет результат в текстовые поля, психолог
// может отредактировать перед сохранением.
//
// Раньше кнопка "Сгенерировать" была задизейблена, а промпты в
// lib/prompts/soap.ts существовали, но ни один API route их не вызывал —
// это первое реальное подключение.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const envStatus = checkYandexGptEnv();
  if (!envStatus.configured) {
    return NextResponse.json(
      { error: `YandexGPT не настроен. Добавьте ключи в .env: ${envStatus.missing.join(", ")}` },
      { status: 503 }
    );
  }

  const { id: sessionId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { template_id?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Тело необязательно — генерация без выбранного шаблона (базовый формат).
  }

  let template: { id: string; title: string | null; content: string } | null = null;
  if (body.template_id) {
    const { data: templateRow, error: templateError } = await supabase
      .from("knowledge_base")
      .select("id, title, content")
      .eq("id", body.template_id)
      .eq("psychologist_id", user.id)
      .eq("source_type", "protocol")
      .maybeSingle();
    if (templateError) {
      return NextResponse.json({ error: templateError.message }, { status: 500 });
    }
    if (!templateRow) {
      return NextResponse.json({ error: "Выбранный шаблон протокола не найден" }, { status: 404 });
    }
    template = templateRow;
  }

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, scheduled_at, client_id, clients ( name )")
    .eq("id", sessionId)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }

  const clientRel = Array.isArray(session.clients) ? session.clients[0] : session.clients;
  const clientName = (clientRel as { name?: string } | null)?.name ?? "Клиент";
  const clientId = session.client_id as string;

  // Транскрипт уже анонимизирован при сохранении (см. /api/webhooks/recording) —
  // читаем как есть, повторная анонимизация не нужна.
  const { data: transcript } = await supabase
    .from("session_transcripts")
    .select("raw_text")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const hasTranscript = Boolean(transcript?.raw_text);
  if (!hasTranscript) {
    return NextResponse.json(
      { error: "Транскрипт для этой сессии ещё не готов. Заполните протокол вручную или дождитесь обработки записи." },
      { status: 409 }
    );
  }

  // Порядковый номер сессии клиента (для "Сессия №N" в промпте) и
  // краткий контекст предыдущих сессий — берём готовые гипотезы
  // психолога (a_assessment) из предыдущих протоколов этого клиента,
  // без отдельного дорогого LLM-вызова на резюме.
  const { data: clientSessions } = await supabase
    .from("sessions")
    .select("id, scheduled_at")
    .eq("client_id", clientId)
    .eq("psychologist_id", user.id)
    .order("scheduled_at", { ascending: true });

  const orderedIds = (clientSessions ?? []).map(s => s.id as string);
  const sessionNumber = Math.max(1, orderedIds.indexOf(sessionId) + 1);
  const previousSessionIds = orderedIds.slice(0, Math.max(0, orderedIds.indexOf(sessionId))).slice(-3);

  let previousSessionsSummary: string | undefined;
  if (previousSessionIds.length > 0) {
    const { data: previousNotes } = await supabase
      .from("soap_notes")
      .select("session_id, a_assessment, p_plan")
      .in("session_id", previousSessionIds);
    if (previousNotes && previousNotes.length > 0) {
      previousSessionsSummary = previousNotes
        .map(n => {
          const gist = [n.a_assessment, n.p_plan].filter(Boolean).join(" ");
          return gist ? `— ${gist}` : null;
        })
        .filter(Boolean)
        .join("\n");
    }
  }

  const systemPrompt = selectSoapSystemPrompt(hasTranscript);
  const userMessage = buildSoapUserMessage({
    transcript: transcript!.raw_text as string,
    notes: "",
    previousSessionsSummary,
    clientName,
    sessionNumber,
    templateContent: template?.content,
    templateTitle: template?.title ?? undefined,
  });

  let result: SoapResult;
  try {
    result = await yandexGptCompleteJson<SoapResult>([
      { role: "system", text: systemPrompt },
      { role: "user", text: userMessage },
    ]);
  } catch (e) {
    const message = e instanceof YandexGptError ? e.message : "Не удалось сгенерировать протокол";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const patch = {
    s_subjective: result.s ?? "",
    o_objective: result.o ?? "",
    a_assessment: result.a ?? "",
    p_plan: result.p ?? "",
    ai_generated: true,
    protocol_template_id: template?.id ?? null,
  };

  const { data: existing } = await supabase
    .from("soap_notes")
    .select("id")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const query = existing
    ? supabase.from("soap_notes").update(patch).eq("id", existing.id)
    : supabase.from("soap_notes").insert({ session_id: sessionId, ...patch });

  const { data: saved, error: saveError } = await query
    .select("id, s_subjective, o_objective, a_assessment, p_plan, updated_at")
    .single();

  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  return NextResponse.json({
    soapNote: {
      id: saved.id,
      s: saved.s_subjective ?? "",
      o: saved.o_objective ?? "",
      a: saved.a_assessment ?? "",
      p: saved.p_plan ?? "",
      updatedAt: saved.updated_at,
    },
  });
}
