import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { addExtraRequests, getAssistantLimitStatus, isInvitePlan, EXTRA_PACK_SIZE } from "@/lib/assistantLimits";

// POST /api/assistant/credits — докупка пакета запросов.
// Оплата пока не подключена (бета): пакет начисляется сразу.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { data: cur } = await supabase.from("psychologists").select("plan_name").eq("id", user.id).single();
  if (isInvitePlan(cur?.plan_name as string | null)) {
    return NextResponse.json({ error: "В бете запросы добавляет команда ТОЛК — напишите в «Помощь»." }, { status: 403 });
  }

  try {
    await addExtraRequests(supabase, user.id, EXTRA_PACK_SIZE);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Не удалось начислить запросы" },
      { status: 500 }
    );
  }
  const status = await getAssistantLimitStatus(supabase, user.id);
  return NextResponse.json({
    ok: true,
    added: EXTRA_PACK_SIZE,
    used: status.used,
    limit: status.limit,
    remaining: status.remaining,
    extra: status.extra,
  });
}
