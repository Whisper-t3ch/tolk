import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAssistantLimitStatus, PLAN_LIMITS } from "@/lib/assistantLimits";

const PLAN_LABELS: Record<string, string> = {
  beta: "Бета",
  practice: "Практика",
  professional: "Профессионал",
  expert: "Эксперт",
};

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatMemberSince(createdAt: string | undefined): string {
  if (!createdAt) return "—";
  const date = new Date(createdAt);
  return date.toLocaleDateString("ru", { month: "long", year: "numeric" });
}

// GET /api/profile
// Возвращает данные текущего психолога для персонализации UI (Sidebar,
// Header, /settings, /profile, /help) — раньше эти места читали
// захардкоженный mock currentPsychologist ("Мария Соколова") вместо
// реального пользователя, что вводило в заблуждение любого психолога,
// кроме автора мока. roomUrl/handle в схеме БД нет отдельной колонки —
// генерируем стабильный идентификатор из user.id (пока видеозвонки
// всё равно не реализованы по-настоящему, см. Трек Б).
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const metadataName = typeof user.user_metadata?.name === "string" ? user.user_metadata.name.trim() : "";
  const fallbackName = user.email ? user.email.split("@")[0] : "Коллега";
  const name = metadataName || fallbackName;

  const { data: psychologist } = await supabase
    .from("psychologists")
    .select("specialty, plan_name")
    .eq("id", user.id)
    .maybeSingle();

  const { data: integrations } = await supabase
    .from("messenger_integrations")
    .select("platform, bot_username, status")
    .eq("psychologist_id", user.id);

  const telegramIntegration = integrations?.find(i => i.platform === "telegram");
  const vkIntegration = integrations?.find(i => i.platform === "vk");

  const limitStatus = await getAssistantLimitStatus(supabase, user.id);
  const handle = user.id.slice(0, 8);

  return NextResponse.json({
    name,
    email: user.email ?? null,
    specialty: psychologist?.specialty ?? "",
    avatarInitials: initialsFromName(name),
    memberSince: formatMemberSince(user.created_at),
    handle,
    roomUrl: `tolk.pro/room/${handle}`,
    plan: {
      name: PLAN_LABELS[limitStatus.planName] ?? limitStatus.planName,
      assistantRequests: { used: limitStatus.used, total: limitStatus.limit },
    },
    telegram: {
      connected: telegramIntegration?.status === "connected",
      username: telegramIntegration?.bot_username ? `@${telegramIntegration.bot_username}` : null,
    },
    vk: {
      connected: vkIntegration?.status === "connected",
    },
    allPlans: PLAN_LIMITS,
  });
}

// PATCH /api/profile
// Body: { name?: string, specialty?: string }
// Сохраняет имя (в auth user_metadata — единственное место, где оно
// хранится, см. комментарий в signUp) и специальность (в psychologists.specialty).
// Раньше форма /profile меняла только локальный useState и ничего не
// сохраняла — после обновления страницы правки психолога терялись.
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { name?: string; specialty?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const name = body.name?.trim();
  const specialty = body.specialty?.trim();

  if (name) {
    const { error: authError } = await supabase.auth.updateUser({ data: { name } });
    if (authError) return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  if (specialty !== undefined) {
    const { error: dbError } = await supabase
      .from("psychologists")
      .update({ specialty })
      .eq("id", user.id);
    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
