import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/assistant/history?client_id=...
//
// Возвращает последнюю сохранённую переписку психолога с ассистентом
// (agent_sessions.messages, JSONB-массив { role, text, at }), чтобы чат
// на фронтенде мог показать историю вместо пустого экрана при каждом
// открытии. client_id пока не используется для фильтрации на уровне БД
// (agent_sessions не хранит client_id отдельной колонкой) — берём просто
// самую свежую сессию психолога.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("agent_sessions")
    .select("id, messages")
    .eq("psychologist_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ agentSessionId: null, messages: [] });
  }

  return NextResponse.json({
    agentSessionId: data.id,
    messages: Array.isArray(data.messages) ? data.messages : [],
  });
}
