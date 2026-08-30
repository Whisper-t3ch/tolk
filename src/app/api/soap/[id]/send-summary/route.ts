import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/soap/[id]/send-summary
// Body: { client_summary: string, channel: string }
//
// ВАЖНО: реальной отправки через мессенджеры (telegram/vk/max) пока
// нет — в схеме БД нет таблицы messages/единого чата, текущий чат в
// /clients — это полностью мок-UI (ChatMessage[] в useState, без
// персистентности). Подключение к реальным ботам telegram/vk/max —
// отдельная задача (нужны токены ботов, вебхуки, таблица переписки),
// не входит в этот шаг. Поэтому здесь: сохраняем client_summary в
// soap_notes (это реальная, персистентная часть), но саму доставку
// клиенту явно помечаем как "не подключено" вместо того, чтобы
// притворяться, что сообщение куда-то ушло.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: soapNoteId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { client_summary?: string; channel?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const clientSummary = body.client_summary?.trim();
  const channel = body.channel;
  if (!clientSummary) {
    return NextResponse.json({ error: "client_summary не может быть пустым" }, { status: 400 });
  }
  if (!channel || !["telegram", "vk", "max"].includes(channel)) {
    return NextResponse.json({ error: "channel должен быть telegram, vk или max" }, { status: 400 });
  }

  // soap_notes не хранит psychologist_id напрямую — принадлежность идёт
  // через session_id → sessions.psychologist_id. Проверяем её явно перед
  // update (не полагаемся только на RLS), иначе психолог А мог бы
  // перезаписать client_summary чужого протокола, подставив чужой id.
  const { data: soapNote, error: soapNoteError } = await supabase
    .from("soap_notes")
    .select("id, session_id, sessions ( psychologist_id )")
    .eq("id", soapNoteId)
    .maybeSingle();
  if (soapNoteError) {
    return NextResponse.json({ error: soapNoteError.message }, { status: 500 });
  }
  if (!soapNote) {
    return NextResponse.json({ error: "SOAP-протокол не найден" }, { status: 404 });
  }
  const sessionRel = Array.isArray(soapNote.sessions) ? soapNote.sessions[0] : soapNote.sessions;
  if ((sessionRel as { psychologist_id?: string } | null)?.psychologist_id !== user.id) {
    return NextResponse.json({ error: "SOAP-протокол не найден" }, { status: 404 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("soap_notes")
    .update({
      client_summary: clientSummary,
      client_summary_sent_at: new Date().toISOString(),
    })
    .eq("id", soapNoteId)
    .select("id, client_summary, client_summary_sent_at")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "SOAP-протокол не найден" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    saved: true,
    delivered: false,
    warning: `Резюме сохранено, но доставка через ${channel} пока не подключена — нужна интеграция с ботом ${channel} (отдельная задача).`,
  });
}
