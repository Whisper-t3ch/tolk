import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildJitsiRoomName } from "@/lib/jitsi";
import { issuePsychologistJwt } from "@/lib/jitsi/jwt";

// POST /api/sessions/[id]/jitsi-token — задача №44, психолог
// запрашивает короткоживущий JWT для входа в свою Jitsi-комнату как
// модератор.
//
// Пока JITSI_JWT_APP_ID/JITSI_JWT_APP_SECRET не заданы в env (а они
// не заданы ни в одном окружении на 02.10.2026 — своей ВМ ещё нет),
// этот роут всегда отвечает { configured: false } и ничего не
// подписывает. Это тот же паттерн "configured"-флага, что уже
// используется в src/lib/jitsi.ts (checkJitsiEnv) — вызывающий
// фронтенд обязан проверять именно его, а не считать токен
// доступным по умолчанию.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    .select("id")
    .eq("id", sessionId)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }

  const roomName = buildJitsiRoomName(sessionId);
  const displayName = (user.user_metadata as { name?: string } | null)?.name;
  const result = issuePsychologistJwt({ roomName, psychologistId: user.id, displayName });

  return NextResponse.json(result);
}
