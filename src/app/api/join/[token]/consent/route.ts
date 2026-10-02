import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeInviteToken } from "@/lib/invites/sessionInvites";
import { buildJitsiRoomName } from "@/lib/jitsi";
import { issueClientJwt, isJitsiJwtConfigured } from "@/lib/jitsi/jwt";

/**
 * POST /api/join/[token]/consent
 *
 * Публичный (без auth) эндпоинт — клиент подтверждает согласие на запись
 * и тем самым ОДНОКРАТНО потребляет invite-токен.
 *
 * Момент потребления токена — единственный момент, когда у нас есть
 * доказанное право клиента войти в звонок (сам факт владения
 * одноразовым токеном). Поэтому выдача Jitsi JWT для роли client
 * сделана ЗДЕСЬ, а не отдельным публичным роутом, принимающим
 * sessionId — такой роут было бы нечем защитить после того, как
 * токен уже потреблён.
 *
 * ВАЖНО (задача №44, 02.10.2026): JWT выдаётся только если
 * isJitsiJwtConfigured() === true, то есть JITSI_JWT_APP_ID/
 * JITSI_JWT_APP_SECRET заданы в env — а они не заданы ни в одном
 * окружении на 02.10.2026 (своей ВМ ещё нет). Поэтому поведение
 * этого роута СЕЙЧАС не меняется: jitsi-поле просто отсутствует в
 * ответе, фронтенд (src/app/join/[token]/page.tsx) его не читает.
 * Когда ВМ появится — потребуется отдельное решение, чтобы реально
 * подключаться к ней с этим токеном (см. комментарий в
 * src/lib/jitsi/jwt.ts).
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

  const roomName = buildJitsiRoomName(resolution.invite.session_id);
  const jitsi = isJitsiJwtConfigured() ? issueClientJwt({ roomName }) : null;

  return NextResponse.json({
    ok: true,
    sessionId: resolution.invite.session_id,
    ...(jitsi ? { jitsi } : {}),
  });
}
