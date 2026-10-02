import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { peekInviteToken } from "@/lib/invites/sessionInvites";

// GET /api/join/[token] — Этап 3.7. Публичный роут (см.
// src/middleware.ts: /api/join/ в PUBLIC_PATH_PREFIXES, тот же принцип,
// что у /api/public/test/[token]) — у клиента физически нет аккаунта,
// доступ контролируется ИСКЛЮЧИТЕЛЬНО знанием правильного токена, не
// сессией/RLS. Сессия берётся ТОЛЬКО из записи, найденной по хешу
// токена — этот роут не принимает sessionId ни в каком виде, поэтому
// подмена sessionId структурно невозможна (см. заголовок
// migration_042_session_invites.sql).
//
// Read-only — для отображения экрана согласия ДО того, как клиент
// нажмёт "Подключиться" (сам consume — в .../consent, POST). Отдаёт
// только то, что нужно показать: имя психолога, время сессии — НЕ
// внутренний session_id напрямую клиенту (та же осторожность, что у
// /api/public/test, не выдающего ключи подсчёта).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  const resolution = await peekInviteToken(admin, token);
  if (!resolution.ok) {
    return NextResponse.json({ valid: false, reason: resolution.reason }, { status: 200 });
  }

  const { data: session, error: sessionError } = await admin
    .from("sessions")
    .select("id, scheduled_at, psychologist_id")
    .eq("id", resolution.invite.session_id)
    .maybeSingle();
  if (sessionError || !session) {
    return NextResponse.json({ valid: false, reason: "not_found" }, { status: 200 });
  }

  const { data: authUser } = await admin.auth.admin.getUserById(session.psychologist_id as string);
  const psychologistName =
    typeof authUser?.user?.user_metadata?.name === "string" ? authUser.user.user_metadata.name.trim() : "Психолог";

  return NextResponse.json({
    valid: true,
    psychologistName,
    scheduledAt: session.scheduled_at,
    expiresAt: resolution.invite.expires_at,
  });
}
