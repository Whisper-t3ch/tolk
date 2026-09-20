import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/clients/[id]/export/summaries
// Выгружает компактный обзор истории клиента без полных транскриптов —
// все SOAP-протоколы (S/O/A/P) по сессиям клиента списком, в
// хронологическом порядке, в один .txt файл. В отличие от
// /export/transcripts (сырой текст сессии), здесь только то, что
// психолог/агент уже зафиксировал как структурированную заметку —
// на порядок компактнее и быстрее просматривается.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
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
    .order("scheduled_at", { ascending: true });

  if (sessionsError) {
    return NextResponse.json({ error: sessionsError.message }, { status: 500 });
  }
  if (!sessions || sessions.length === 0) {
    return NextResponse.json({ error: "У клиента нет сессий" }, { status: 404 });
  }

  const sessionIds = sessions.map(s => s.id as string);
  const { data: soapNotes, error: soapError } = await supabase
    .from("soap_notes")
    .select("session_id, s_subjective, o_objective, a_assessment, p_plan, created_at")
    .in("session_id", sessionIds)
    .order("created_at", { ascending: false });

  if (soapError) {
    return NextResponse.json({ error: soapError.message }, { status: 500 });
  }

  // На сессию может быть несколько версий протокола — берём самую свежую.
  const latestBySession = new Map<
    string,
    { s: string; o: string; a: string; p: string }
  >();
  for (const note of soapNotes ?? []) {
    const sid = note.session_id as string;
    if (latestBySession.has(sid)) continue;
    const hasContent =
      note.s_subjective || note.o_objective || note.a_assessment || note.p_plan;
    if (!hasContent) continue;
    latestBySession.set(sid, {
      s: (note.s_subjective as string) ?? "",
      o: (note.o_objective as string) ?? "",
      a: (note.a_assessment as string) ?? "",
      p: (note.p_plan as string) ?? "",
    });
  }

  const sections: string[] = [];
  let sessionNumber = 0;
  for (const session of sessions) {
    sessionNumber += 1;
    const note = latestBySession.get(session.id as string);
    if (!note) continue; // пропускаем сессии без готового протокола
    const date = new Date(session.scheduled_at as string).toISOString().slice(0, 10);
    sections.push(
      `=== Сессия №${sessionNumber} от ${date} ===\n` +
        `S (субъективно): ${note.s || "—"}\n` +
        `O (объективно): ${note.o || "—"}\n` +
        `A (оценка): ${note.a || "—"}\n` +
        `P (план): ${note.p || "—"}\n`
    );
  }

  if (sections.length === 0) {
    return NextResponse.json({ error: "Ни для одной сессии протокол ещё не готов" }, { status: 404 });
  }

  const body = sections.join("\n");
  const safeClientName = (client.name as string).replace(/[^\p{L}\p{N}_-]+/gu, "_");
  const filename = `summaries_${safeClientName}.txt`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
