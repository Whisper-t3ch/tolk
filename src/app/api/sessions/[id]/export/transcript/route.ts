import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/sessions/[id]/export/transcript
// Возвращает текст транскрипта сессии как .txt файл.
// Доступ к самой сессии уже ограничен RLS (sessions_select_own),
// а session_transcripts читается через join-проверку на sessions.
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
    .select("id, scheduled_at, client_id, clients ( name )")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }

  const { data: transcript, error: transcriptError } = await supabase
    .from("session_transcripts")
    .select("raw_text")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (transcriptError) {
    return NextResponse.json({ error: transcriptError.message }, { status: 500 });
  }
  if (!transcript?.raw_text) {
    return NextResponse.json({ error: "Транскрипт для этой сессии ещё не готов" }, { status: 404 });
  }

  const clientRel = Array.isArray(session.clients) ? session.clients[0] : session.clients;
  const clientName = (clientRel as { name?: string } | null)?.name ?? "client";
  const date = new Date(session.scheduled_at as string).toISOString().slice(0, 10);
  const safeClientName = clientName.replace(/[^\p{L}\p{N}_-]+/gu, "_");
  const filename = `session_${date}_${safeClientName}.txt`;

  return new NextResponse(transcript.raw_text as string, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
