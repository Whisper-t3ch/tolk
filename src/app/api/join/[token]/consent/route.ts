import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeInviteToken } from "@/lib/invites/sessionInvites";

/**
 * POST /api/join/[token]/consent
 *
 * Публичный (без auth) эндпоинт — клиент подтверждает согласие на запись
 * и тем самым ОДНОКРАТНО потребляет invite-токен.
 *
 * Важно: этот роут только фиксирует потребление токена и возвращает
 * session_id для дальнейшего использования фронтендом. Собственно
 * подключение к Jitsi-звонку (выдача JWT для роли client) — отдельная
 * задача (Этап 4 / задача №44), ещё не реализована. Здесь мы НЕ
 * выпускаем никакого токена доступа к звонку.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: rawToken } = await params;

  if (!rawToken || typeof rawToken !== "string") {
    return NextResponse.json(
      { ok: false, reason: "not_found" as const },
      { status: 200 }
    );
  }

  let consentGiven = true;
  try {
    const body = await request.json().catch(() => null);
    if (body && typeof body === "object" && "consent" in body) {
      consentGiven = Boolean((body as { consent?: unknown }).consent);
    }
  } catch {
    // тело не обязательно — отсутствие body означает "согласие дано"
  }

  if (!consentGiven) {
    return NextResponse.json(
      { ok: false, reason: "consent_required" as const },
      { status: 200 }
    );
  }

  const admin = createAdminClient();
  const resolution = await consumeInviteToken(admin, rawToken);

  if (!resolution.ok) {
    return NextResponse.json(
      { ok: false, reason: resolution.reason },
      { status: 200 }
    );
  }

  return NextResponse.json({
    ok: true,
    sessionId: resolution.invite.session_id,
  });
}
