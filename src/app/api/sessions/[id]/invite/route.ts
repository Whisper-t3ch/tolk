import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionInvite, DEFAULT_INVITE_TTL_MINUTES } from "@/lib/invites/sessionInvites";
import { deliverInviteToClientChat, type InviteDelivery } from "@/lib/invites/deliverInvite";

// POST /api/sessions/[id]/invite — Этап 3.7, психолог создаёт
// одноразовую ссылку для клиента на эту сессию. Владение сессией
// проверяется обычным cookie-клиентом (как и во всех recording-роутах
// выше), а сама запись в session_invites — через service-role, т.к.
// у таблицы нет RLS-политик для authenticated (см. заголовок
// migration_042_session_invites.sql — резолюция по токену анонимна,
// единой модели доступа через RLS для этой таблицы не выстроить).
//
// Тело запроса (опционально): { ttlMinutes?: number } — на сколько
// минут действует ссылка, по умолчанию DEFAULT_INVITE_TTL_MINUTES (3
// часа — покрывает типичную консультацию с запасом на опоздание).
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
    .select("id, client_id")
    .eq("id", sessionId)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }

  let body: { ttlMinutes?: number; send?: boolean; resend?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    // Тело необязательно — используется DEFAULT_INVITE_TTL_MINUTES.
  }
  const ttlMinutes = Number.isFinite(body.ttlMinutes) && (body.ttlMinutes as number) > 0 ? body.ttlMinutes : DEFAULT_INVITE_TTL_MINUTES;

  const admin = createAdminClient();
  const result = await createSessionInvite(admin, { sessionId, createdBy: user.id, ttlMinutes });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  const url = `${appUrl}/join/${result.rawToken}`;

  // Автоотправка ссылки в чат клиента (Telegram/VK), если он привязан. Без привязки ссылка
  // остаётся в ответе: интерфейс показывает её с кнопкой «Скопировать». Повторная автоотправка
  // по той же сессии подавляется (resend:true — отправить ещё раз по явной кнопке психолога).
  let delivery: InviteDelivery = { status: "no_channel" };
  if (body.send !== false && session.client_id) {
    const hours = Math.round((Number(ttlMinutes) / 60) * 10) / 10;
    delivery = await deliverInviteToClientChat(supabase, {
      psychologistId: user.id,
      clientId: session.client_id as string,
      sessionId,
      text: `Здравствуйте! Ссылка на видеосессию: ${url} (действует ${hours} ч., открывайте с устройства, где есть камера и микрофон). Перед входом в звонок лучше отключить VPN — со включённым VPN связь может тормозить.`,
      dedupeMinutes: body.resend ? 0 : Number(ttlMinutes),
    });
    console.log("SESSION_INVITE_DELIVERY", JSON.stringify({ status: delivery.status }));
  }

  return NextResponse.json({
    ok: true,
    token: result.rawToken,
    url,
    expiresAt: result.invite.expires_at,
    delivery,
  });
}
