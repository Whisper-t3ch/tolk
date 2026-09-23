import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/sessions/[id]/recording/heartbeat
// Body: RecordingStatusSnapshot (src/lib/recording/sessionRecorder.ts),
// без sessionId — он уже в URL. Отправляется каждые 10-15с из
// JitsiCallView, пока идёт запись.
//
// Зачем отдельно от /recording/chunks: фрагменты приходят раз в ~20с
// на дорожку, а тихий отказ (MediaRecorder остановился, удалённая
// дорожка пропала, но сама вкладка жива) не обязательно сразу
// прекращает поток фрагментов с ДРУГОЙ дорожки — по одним только
// chunks backend не отличит "дорожка клиента временно пуста" от
// "дорожка клиента не пишется вообще". Heartbeat несёт именно этот
// снапшот состояния recorder'а целиком.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    .select("id, recording_status")
    .eq("id", sessionId)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  // Снапшот не валидируется строго построчно (это диагностическая
  // телеметрия, не источник истины для целостности записи — за неё
  // отвечает manifest), но должен быть объектом, чтобы не улетело
  // что попало в jsonb-колонку.
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Тело запроса должно быть объектом" }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    recording_heartbeat_at: new Date().toISOString(),
    recording_client_state: JSON.stringify(body),
  };
  if (session.recording_status === "none" || session.recording_status === null) {
    update.recording_status = "recording";
  }

  const { error: updateError } = await supabase.from("sessions").update(update).eq("id", sessionId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
