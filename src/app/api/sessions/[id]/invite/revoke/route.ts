import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revokeSessionInvites } from "@/lib/invites/sessionInvites";

// POST /api/sessions/[id]/invite/revoke — Этап 3.7. Психолог решил,
// что уже разосланная ссылка больше не должна работать (ошиблись при
// отправке, перенесли сессию и т.п.) — отзывает ВСЕ активные
// приглашения этой сессии разом. Старые ссылки сразу перестают
// резолвиться (consumeInviteToken вернёт reason:'revoked').
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

  const admin = createAdminClient();
  const result = await revokeSessionInvites(admin, sessionId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, revoked: result.revoked });
}
