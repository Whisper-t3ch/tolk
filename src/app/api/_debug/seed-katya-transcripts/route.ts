import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anonymizeTranscript } from "@/lib/anonymize";
import { yandexGptEmbed } from "@/lib/yandexgpt";
import { readFileSync } from "fs";
import path from "path";

// ВРЕМЕННЫЙ debug-эндпоинт — одноразовая загрузка 10 транскриптов
// тестового клиента "Катя (тест истории)" для проверки стоимости
// ассистента на клиенте с большой историей (см. задачу про worst-case
// стоимость перед стартом беты). Тексты лежат в
// scripts/seed_katya_sessions/session_NN.txt (реальный материал,
// приложенный психологом-пользователем, разбитый на 10 сессий по
// найденным в тексте разделителям).
//
// Body: { sessionIds: string[] } — 10 id в хронологическом порядке,
// соответствующем session_01..session_10.
//
// Как и /api/sessions/[id]/transcript: анонимизация перед записью,
// embedding для RAG, source='manual'. Удалить этот файл и папку
// scripts/seed_katya_sessions после завершения теста (см. задачу
// "Удалить debug-эндпоинт seed-katya-transcripts" — тот же паттерн,
// что и reset-limit-temp ранее в этом проекте).
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { sessionIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const sessionIds = body.sessionIds ?? [];
  if (sessionIds.length !== 10) {
    return NextResponse.json({ error: "Нужно ровно 10 sessionIds, в хронологическом порядке" }, { status: 400 });
  }

  const results: Array<{ index: number; sessionId: string; ok: boolean; error?: string; chars?: number; embeddingSaved?: boolean }> = [];

  for (let i = 0; i < 10; i++) {
    const sessionId = sessionIds[i];
    const fileName = `session_${String(i + 1).padStart(2, "0")}.txt`;
    try {
      const filePath = path.join(process.cwd(), "scripts", "seed_katya_sessions", fileName);
      const text = readFileSync(filePath, "utf-8").trim();

      const { data: session, error: sessionError } = await supabase
        .from("sessions")
        .select("id, client_id, clients ( name )")
        .eq("id", sessionId)
        .eq("psychologist_id", user.id)
        .maybeSingle();
      if (sessionError || !session) {
        results.push({ index: i + 1, sessionId, ok: false, error: sessionError?.message ?? "Сессия не найдена" });
        continue;
      }

      const clientRel = Array.isArray(session.clients) ? session.clients[0] : session.clients;
      const clientName = (clientRel as { name?: string } | null)?.name ?? "";

      const anonymizedText = await anonymizeTranscript(text, clientName);

      let embedding: number[] | null = null;
      try {
        embedding = await yandexGptEmbed(anonymizedText, "doc");
      } catch (e) {
        embedding = null;
        console.error("seed-katya: embedding failed for", fileName, e instanceof Error ? e.message : e);
      }

      const { error: insertError } = await supabase.from("session_transcripts").insert({
        session_id: sessionId,
        raw_text: anonymizedText,
        source: "manual",
        embedding,
      });
      if (insertError) {
        results.push({ index: i + 1, sessionId, ok: false, error: insertError.message });
        continue;
      }

      await supabase
        .from("sessions")
        .update({ recording_status: "ready", transcript_error: null })
        .eq("id", sessionId);

      results.push({ index: i + 1, sessionId, ok: true, chars: anonymizedText.length, embeddingSaved: embedding !== null });
    } catch (e) {
      results.push({ index: i + 1, sessionId, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ results });
}
