import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/clients/[id]/export/transcripts
// Выгружает все транскрипты сессий клиента в один .txt файл,
// отсортированные по дате сессии по возрастанию.
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
  const { data: transcripts, error: transcriptsError } = await supabase
    .from("session_transcripts")
    .select("session_id, raw_text, created_at")
    .in("session_id", sessionIds)
    .order("created_at", { ascending: false });

  if (transcriptsError) {
    return NextResponse.json({ error: transcriptsError.message }, { status: 500 });
  }

  // На сессию может быть несколько записей транскрипта (например, после
  // повторной обработки) — берём самую свежую на session_id.
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
    if (!text) continue; // пропускаем сессии без готового транскрипта
    const date = new Date(session.scheduled_at as string).toISOString().slice(0, 10);
    sections.push(`=== Сессия №${sessionNumber} от ${date} ===\n${text}\n`);
  }

  if (sections.length === 0) {
    return NextResponse.json({ error: "Ни для одной сессии транскрипт ещё не готов" }, { status: 404 });
  }

  const body = sections.join("\n");
  const safeClientName = (client.name as string).replace(/[^\p{L}\p{N}_-]+/gu, "_");
  const filename = `transcripts_${safeClientName}.txt`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
