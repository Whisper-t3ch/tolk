import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/sessions/[id]/duration { elapsedSeconds }
// По окончании консультации сохраняет фактическую длительность вместо
// запланированных 50 минут. Меньше 30 секунд — считаем, что сессия не
// состоялась, и ничего не меняем (остаётся плановое значение).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  let body: { elapsedSeconds?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }
  const sec = Number(body.elapsedSeconds);
  if (!Number.isFinite(sec) || sec < 30) {
    return NextResponse.json({ ok: true, skipped: true });
  }
  // Минимум 1 минута, максимум 12 часов (защита от мусорных значений).
  const minutes = Math.min(720, Math.max(1, Math.round(sec / 60)));

  const { error } = await supabase
    .from("sessions")
    .update({ duration_minutes: minutes })
    .eq("id", sessionId)
    .eq("psychologist_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, durationMinutes: minutes });
}
