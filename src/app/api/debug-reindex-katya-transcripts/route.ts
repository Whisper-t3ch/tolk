import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { chunkAndEmbedTranscript } from "@/lib/transcriptChunking";

// ВРЕМЕННЫЙ debug-эндпоинт — удалить после теста "Уровень 1.1"
// (снижение CHUNK_SIZE_CHARS 4000 -> 1050). Существующие чанки Кати
// были посчитаны старым размером и не пересчитываются автоматически
// изменением константы — нужно вручную пересобрать их из уже
// сохранённого session_transcripts.raw_text (текст уже анонимизирован,
// повторно анонимизировать не нужно).
export async function GET() {
  const supabase = await createClient();

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, name")
    .ilike("name", "%Катя%")
    .maybeSingle();

  if (clientError) return NextResponse.json({ error: clientError.message }, { status: 500 });
  if (!client) return NextResponse.json({ error: "Клиент 'Катя' не найден" }, { status: 404 });

  const { data: sessions, error: sessionsError } = await supabase
    .from("sessions")
    .select("id, scheduled_at")
    .eq("client_id", client.id)
    .order("scheduled_at", { ascending: true });

  if (sessionsError) return NextResponse.json({ error: sessionsError.message }, { status: 500 });
  if (!sessions || sessions.length === 0) {
    return NextResponse.json({ error: "У Кати нет сессий" }, { status: 404 });
  }

  const sessionIds = sessions.map(s => s.id as string);
  const { data: transcripts, error: transcriptsError } = await supabase
    .from("session_transcripts")
    .select("session_id, raw_text, created_at")
    .in("session_id", sessionIds)
    .order("created_at", { ascending: false });

  if (transcriptsError) return NextResponse.json({ error: transcriptsError.message }, { status: 500 });

  const latestBySession = new Map<string, string>();
  for (const t of transcripts ?? []) {
    const sid = t.session_id as string;
    if (!latestBySession.has(sid) && t.raw_text) {
      latestBySession.set(sid, t.raw_text as string);
    }
  }

  const results: Array<{ sessionId: string; chunksTotal: number; chunksEmbedded: number }> = [];
  for (const [sessionId, text] of latestBySession.entries()) {
    const { chunksTotal, chunksEmbedded } = await chunkAndEmbedTranscript(supabase, sessionId, text);
    results.push({ sessionId, chunksTotal, chunksEmbedded });
  }

  return NextResponse.json({
    ok: true,
    clientId: client.id,
    sessionsReindexed: results.length,
    results,
  });
}
