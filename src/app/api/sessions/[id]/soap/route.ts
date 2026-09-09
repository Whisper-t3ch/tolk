import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildJitsiRoomName, buildJitsiUrl } from "@/lib/jitsi";

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
    .select("id, scheduled_at, duration_minutes, client_id, status, jitsi_room_name, recording_status, clients ( name )")
    .eq("id", sessionId)
    .eq("psychologist_id", user.id)
    .maybeSingle();

  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }

  const { data: soapNote, error: soapError } = await supabase
    .from("soap_notes")
    .select("id, s_subjective, o_objective, a_assessment, p_plan, client_summary, client_summary_sent_at, protocol_template_id, created_at, updated_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (soapError) {
    return NextResponse.json({ error: soapError.message }, { status: 500 });
  }

  // Список доступных шаблонов протоколов для выбора на странице —
  // тот же источник, что вкладка "Шаблоны протоколов" в базе знаний
  // (закрывает обрыв: шаблоны существовали, но не применялись к реальной
  // заметке сессии, см. migration_017_soap_protocol_template.sql).
  const { data: templates } = await supabase
    .from("knowledge_base")
    .select("id, title, content")
    .eq("psychologist_id", user.id)
    .eq("source_type", "protocol")
    .order("created_at", { ascending: true });

  const clientRel = Array.isArray(session.clients) ? session.clients[0] : session.clients;
  const roomName = (session.jitsi_room_name as string | null) || buildJitsiRoomName(session.id as string);

  return NextResponse.json({
    session: {
      id: session.id,
      scheduledAt: session.scheduled_at,
      durationMinutes: session.duration_minutes,
      clientId: session.client_id,
      clientName: (clientRel as { name?: string } | null)?.name ?? "",
      status: session.status,
      videoRoomUrl: buildJitsiUrl(roomName),
      recordingStatus: session.recording_status,
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
          protocolTemplateId: soapNote.protocol_template_id,
          createdAt: soapNote.created_at,
          updatedAt: soapNote.updated_at,
        }
      : null,
    templates: templates ?? [],
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

  let body: { s?: string; o?: string; a?: string; p?: string; protocol_template_id?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  // Подтверждаем, что сессия существует и принадлежит психологу — явная
  // проверка владельца здесь обязательна (не полагаемся только на RLS),
  // иначе психолог А мог бы читать/писать SOAP-протокол чужой сессии,
  // подставив чужой session_id в URL.
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("psychologist_id", user.id)
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

  const patch: Record<string, unknown> = {
    s_subjective: body.s ?? "",
    o_objective: body.o ?? "",
    a_assessment: body.a ?? "",
    p_plan: body.p ?? "",
  };
  // protocol_template_id обновляем только если явно передан ключ в body —
  // undefined означает "не трогай", а не "сбрось на NULL" (иначе обычное
  // сохранение текста полей молча стирало бы уже выбранный шаблон).
  if ("protocol_template_id" in body) {
    patch.protocol_template_id = body.protocol_template_id ?? null;
  }

  if (existing) {
    const { data: updated, error: updateError } = await supabase
      .from("soap_notes")
      .update(patch)
      .eq("id", existing.id)
      .select("id, s_subjective, o_objective, a_assessment, p_plan, protocol_template_id, updated_at")
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
    .select("id, s_subjective, o_objective, a_assessment, p_plan, protocol_template_id, updated_at")
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
  protocol_template_id: string | null;
  updated_at: string;
}) {
  return {
    id: row.id,
    s: row.s_subjective ?? "",
    o: row.o_objective ?? "",
    a: row.a_assessment ?? "",
    p: row.p_plan ?? "",
    protocolTemplateId: row.protocol_template_id,
    updatedAt: row.updated_at,
  };
}
