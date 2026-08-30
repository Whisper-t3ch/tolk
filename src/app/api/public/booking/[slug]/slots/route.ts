import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateAvailableSlots, type WorkingHours } from "@/lib/booking";

// GET /api/public/booking/[slug]/slots?from=YYYY-MM-DD&to=YYYY-MM-DD
// (или ?date=YYYY-MM-DD для одного дня)
//
// Публичный роут — БЕЗ авторизации, это сама точка входа для клиента,
// у которого нет и не будет аккаунта психолога. Использует
// createAdminClient() (service role, обходит RLS) по той же причине,
// что и /api/webhooks/* — здесь физически нет пользовательской сессии
// психолога, только сам факт знания публичного slug. Именно поэтому
// КАЖДЫЙ запрос к sessions/booking_settings ниже вручную ограничен
// конкретным psychologist_id — без этого admin-клиент отдал бы данные
// всех психологов сразу, RLS его не остановит.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = createAdminClient();

  const { data: settings, error: settingsError } = await supabase
    .from("booking_settings")
    .select("psychologist_id, working_hours, session_duration_minutes, buffer_minutes, min_notice_hours, max_advance_days, is_active")
    .eq("public_slug", slug)
    .maybeSingle();

  if (settingsError) {
    return NextResponse.json({ error: settingsError.message }, { status: 500 });
  }
  if (!settings || !settings.is_active) {
    return NextResponse.json({ error: "Страница бронирования не найдена" }, { status: 404 });
  }

  // Имя/специализация для шапки публичной страницы — имя берём из
  // auth.users.user_metadata (нет отдельной колонки name в psychologists,
  // см. /api/profile), admin-клиент может читать auth.admin API.
  let psychologistName = "Психолог";
  const { data: authUser } = await supabase.auth.admin.getUserById(settings.psychologist_id);
  const metadataName = typeof authUser?.user?.user_metadata?.name === "string" ? authUser.user.user_metadata.name.trim() : "";
  if (metadataName) psychologistName = metadataName;

  const { data: profile } = await supabase
    .from("psychologists")
    .select("specialty")
    .eq("id", settings.psychologist_id)
    .maybeSingle();

  const now = new Date();
  const dateParam = request.nextUrl.searchParams.get("date");
  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");

  const maxDate = new Date(now.getTime() + settings.max_advance_days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayStr = now.toISOString().slice(0, 10);

  let fromDate = dateParam ?? fromParam ?? todayStr;
  let toDate = dateParam ?? toParam ?? maxDate;
  // Не позволяем запрашивать дальше max_advance_days и раньше сегодняшнего дня,
  // даже если это явно передано в query — иначе клиент мог бы забронировать
  // слот далеко за пределами того, что психолог разрешил в настройках.
  if (fromDate < todayStr) fromDate = todayStr;
  if (toDate > maxDate) toDate = maxDate;
  if (fromDate > toDate) {
    return NextResponse.json({ error: "Некорректный диапазон дат" }, { status: 400 });
  }

  const { data: existingSessions, error: sessionsError } = await supabase
    .from("sessions")
    .select("scheduled_at, duration_minutes")
    .eq("psychologist_id", settings.psychologist_id)
    .neq("status", "cancelled")
    .gte("scheduled_at", `${fromDate}T00:00:00Z`)
    .lte("scheduled_at", `${toDate}T23:59:59Z`);

  if (sessionsError) {
    return NextResponse.json({ error: sessionsError.message }, { status: 500 });
  }

  const occupied = (existingSessions ?? []).map(s => {
    const start = new Date(s.scheduled_at as string);
    const durationMin = (s.duration_minutes as number | null) ?? settings.session_duration_minutes;
    const end = new Date(start.getTime() + durationMin * 60_000);
    return { start: start.toISOString(), end: end.toISOString() };
  });

  const slots = generateAvailableSlots({
    fromDate,
    toDate,
    workingHours: settings.working_hours as WorkingHours,
    sessionDurationMinutes: settings.session_duration_minutes,
    bufferMinutes: settings.buffer_minutes,
    minNoticeHours: settings.min_notice_hours,
    occupied,
    now,
  });

  return NextResponse.json({
    slots,
    psychologist: { name: psychologistName, specialty: profile?.specialty ?? null },
    session_duration_minutes: settings.session_duration_minutes,
  });
}
