import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SWITCHABLE_PLANS, getAssistantLimitStatus, isInvitePlan } from "@/lib/assistantLimits";

// POST /api/profile/plan { plan: "practice" | "professional" | "expert" }
// Смена тарифа без оплаты (бета; оплату подключим позже). Использованные
// запросы в текущем месяце сохраняются.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  let body: { plan?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }
  const plan = body.plan;
  if (!plan || !(SWITCHABLE_PLANS as readonly string[]).includes(plan)) {
    return NextResponse.json({ error: `plan должен быть одним из: ${SWITCHABLE_PLANS.join(", ")}` }, { status: 400 });
  }

  // Тариф беты задан инвайт-кодом — сменить его самому нельзя (иначе пробный/платный обойдёт лимиты).
  const { data: cur } = await supabase.from("psychologists").select("plan_name").eq("id", user.id).single();
  if (isInvitePlan(cur?.plan_name as string | null)) {
    return NextResponse.json({ error: "В бете тариф задаётся инвайт-кодом. Нужно больше запросов — напишите в «Помощь»." }, { status: 403 });
  }

  const { error } = await supabase.from("psychologists").update({ plan_name: plan }).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const status = await getAssistantLimitStatus(supabase, user.id);
  return NextResponse.json({ ok: true, planName: status.planName, limit: status.limit, used: status.used });
}
