import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/sessions/[id]/soap
// Возвращает существующий soap_notes для сессии (если есть) вместе
// с базовой информацией о сессии/клиенте для шапки страницы.
// Если протокола ещё нет — soap_note: null (не ошибка, штатное состояние
// "Протокол не создан").
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, scheduled_at, duration_minutes, client_id, clients ( name )")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }

  const { data: soapNote, error: soapError } = await supabase
    .from("soap_notes")
    .select("id, s_subjective, o_objective, a_assessment, p_plan, client_summary, client_summary_sent_at, created_at, updated_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (soapError) {
    return NextResponse.json({ error: soapError.message }, { status: 500 });
  }

  const clientRel = Array.isArray(session.clients) ? session.clients[0] : session.clients;

  return NextResponse.json({
    session: {
      id: session.id,
      scheduledAt: session.scheduled_at,
      durationMinutes: session.duration_minutes,
      clientId: session.client_id,
      clientName: (clientRel as { name?: string } | null)?.name ?? "",
    },
    soapNote: soapNote
      ? {
          id: soapNote.id,
          s: soapNote.s_subjective ?? "",
          o: soapNote.o_objective ?? "",
          a: soapNote.a_assessment ?? "",
          p: soapNote.p_plan ?? "",
          clientSummary: soapNote.client_summary,
          clientSummarySentAt: soapNote.client_summary_sent_at,
          createdAt: soapNote.created_at,
          updatedAt: soapNote.updated_at,
        }
      : null,
  });
}

// PUT /api/sessions/[id]/soap
// Body: { s, o, a, p }
// Обновляет существующий soap_notes. Если его ещё нет — создаёт новый
// (на случай, когда психолог правит протокол до первой генерации через
// LLM — например, вписывает заметки вручную).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { s?: string; o?: string; a?: string; p?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  // Подтверждаем, что сессия существует и принадлежит психологу
  // (RLS на sessions это тоже проверит, но явная проверка даёт понятную
  // ошибку 404 вместо непрозрачного отказа при insert).
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }

  const { data: existing, error: existingError } = await supabase
    .from("soap_notes")
    .select("id")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const patch = {
    s_subjective: body.s ?? "",
    o_objective: body.o ?? "",
    a_assessment: body.a ?? "",
    p_plan: body.p ?? "",
  };

  if (existing) {
    const { data: updated, error: updateError } = await supabase
      .from("soap_notes")
      .update(patch)
      .eq("id", existing.id)
      .select("id, s_subjective, o_objective, a_assessment, p_plan, updated_at")
      .single();
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    return NextResponse.json({ soapNote: mapSoapRow(updated) });
  }

  const { data: created, error: createError } = await supabase
    .from("soap_notes")
    .insert({
      session_id: sessionId,
      ...patch,
      ai_generated: false,
    })
    .select("id, s_subjective, o_objective, a_assessment, p_plan, updated_at")
    .single();
  if (createError) {
    return NextResponse.json({ error: createError.message }, { status: 500 });
  }
  return NextResponse.json({ soapNote: mapSoapRow(created) });
}

function mapSoapRow(row: {
  id: string;
  s_subjective: string | null;
  o_objective: string | null;
  a_assessment: string | null;
  p_plan: string | null;
  updated_at: string;
}) {
  return {
    id: row.id,
    s: row.s_subjective ?? "",
    o: row.o_objective ?? "",
    a: row.a_assessment ?? "",
    p: row.p_plan ?? "",
    updatedAt: row.updated_at,
  };
}
