import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAssistantLimitStatus, PLAN_LIMITS } from "@/lib/assistantLimits";

const PLAN_LABELS: Record<string, string> = {
  beta: "Бета",
  practice: "Практика",
  professional: "Профессионал",
  expert: "Эксперт",
};

// GET /api/assistant/limit
// Текущее состояние лимита запросов к ассистенту — используется в
// /settings для счётчика "45 / 200" вместо захардкоженного мока
// currentPsychologist.plan.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const status = await getAssistantLimitStatus(supabase, user.id);

  return NextResponse.json({
    used: status.used,
    limit: status.limit,
    remaining: status.remaining,
    planName: status.planName,
    planLabel: PLAN_LABELS[status.planName] ?? status.planName,
    allPlans: PLAN_LIMITS,
  });
}
