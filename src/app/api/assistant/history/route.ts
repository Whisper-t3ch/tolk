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

// DELETE /api/assistant/history
//
// Начать диалог с чистого листа. Кнопки для этого в интерфейсе не было
// вовсе: история копилась бесконечно, и психолог не мог её сбросить —
// а модель, видя в переписке свой прежний ответ со списком слотов, на
// следующий похожий вопрос переписывала его вместо нового вызова
// инструмента и называла время, когда психолог уже занят.
//
// Историю не удаляем, а очищаем messages у текущей сессии: сама строка
// agent_sessions остаётся (на неё могут ссылаться записи обратной связи
// об ответах ассистента).
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { data: current, error: findError } = await supabase
    .from("agent_sessions")
    .select("id")
    .eq("psychologist_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError) {
    return NextResponse.json({ error: findError.message }, { status: 500 });
  }
  // Диалога ещё не было — сбрасывать нечего, но это не ошибка.
  if (!current) {
    return NextResponse.json({ ok: true });
  }

  const { error: clearError } = await supabase
    .from("agent_sessions")
    .update({ messages: [] })
    .eq("id", current.id)
    .eq("psychologist_id", user.id);

  if (clearError) {
    return NextResponse.json({ error: clearError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
