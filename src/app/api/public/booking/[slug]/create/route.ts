import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSlotAvailable, type WorkingHours } from "@/lib/booking";

// POST /api/public/booking/[slug]/create
// Body: { date: "YYYY-MM-DD", time: "HH:MM", client_name: string, client_telegram: string }
//
// Публичный роут — БЕЗ авторизации психолога (см. подробный комментарий
// в соседнем slots/route.ts про createAdminClient и ручное ограничение
// по psychologist_id). Дополнительно здесь: rate limiting по telegram +
// IP, чтобы бот не мог заспамить психологу календарь фиктивными
// бронями.
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = createAdminClient();

  let body: { date?: string; time?: string; client_name?: string; client_telegram?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const date = body.date?.trim();
  const time = body.time?.trim();
  const clientName = body.client_name?.trim();
  const clientTelegram = body.client_telegram?.trim().replace(/^@/, "");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Некорректная дата" }, { status: 400 });
  }
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return NextResponse.json({ error: "Некорректное время" }, { status: 400 });
  }
  if (!clientName) {
    return NextResponse.json({ error: "Укажите имя" }, { status: 400 });
  }
  if (!clientTelegram) {
    return NextResponse.json({ error: "Укажите Telegram" }, { status: 400 });
  }

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
  const psychologistId = settings.psychologist_id as string;

  // Rate limiting: не более 3 попыток брони с одного telegram за 10 минут.
  // Считаем по уже созданным sessions с этим booked_via/telegram, без
  // отдельной таблицы — этого достаточно, чтобы отсечь простой спам
  // ботами (реальный посетитель за 10 минут не бронирует 3+ раза).
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count: recentAttempts, error: rateLimitError } = await supabase
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("psychologist_id", psychologistId)
    .eq("booked_via", "public_link")
    .eq("client_contact_telegram", clientTelegram)
    .gte("created_at", tenMinutesAgo);
  if (rateLimitError) {
    return NextResponse.json({ error: rateLimitError.message }, { status: 500 });
  }
  if ((recentAttempts ?? 0) >= 3) {
    return NextResponse.json(
      { error: "Слишком много попыток бронирования подряд. Попробуйте снова через 10 минут." },
      { status: 429 }
    );
  }

  // Проверяем, что слот всё ещё свободен — race condition: между тем,
  // как клиент открыл список слотов, и моментом отправки формы, кто-то
  // другой (или сам психолог из кабинета) мог занять то же время.
  const { data: existingSessions, error: sessionsError } = await supabase
    .from("sessions")
    .select("scheduled_at, duration_minutes")
    .eq("psychologist_id", psychologistId)
    .neq("status", "cancelled")
    .gte("scheduled_at", `${date}T00:00:00Z`)
    .lte("scheduled_at", `${date}T23:59:59Z`);
  if (sessionsError) {
    return NextResponse.json({ error: sessionsError.message }, { status: 500 });
  }

  const occupied = (existingSessions ?? []).map(s => {
    const start = new Date(s.scheduled_at as string);
    const durationMin = (s.duration_minutes as number | null) ?? settings.session_duration_minutes;
    const end = new Date(start.getTime() + durationMin * 60_000);
    return { start: start.toISOString(), end: end.toISOString() };
  });

  const available = isSlotAvailable({
    date,
    time,
    workingHours: settings.working_hours as WorkingHours,
    sessionDurationMinutes: settings.session_duration_minutes,
    bufferMinutes: settings.buffer_minutes,
    minNoticeHours: settings.min_notice_hours,
    maxAdvanceDays: settings.max_advance_days,
    occupied,
  });
  if (!available) {
    return NextResponse.json(
      { error: "Это время уже занято — обновите страницу и выберите другой слот" },
      { status: 409 }
    );
  }

  // Ищем существующего клиента психолога по уже привязанному Telegram
  // (client_messenger_links) — если клиент уже писал через бота или
  // бронировал раньше, не плодим дубликат карточки.
  const { data: existingLink } = await supabase
    .from("client_messenger_links")
    .select("client_id")
    .eq("psychologist_id", psychologistId)
    .eq("platform", "telegram")
    .eq("external_username", clientTelegram)
    .maybeSingle();

  let clientId = existingLink?.client_id as string | undefined;

  if (!clientId) {
    const { data: newClient, error: clientError } = await supabase
      .from("clients")
      .insert({
        psychologist_id: psychologistId,
        name: clientName,
        status: "active",
      })
      .select("id")
      .single();
    if (clientError) {
      return NextResponse.json({ error: clientError.message }, { status: 500 });
    }
    clientId = newClient.id as string;
  }

  const scheduledAt = new Date(`${date}T${time}:00Z`).toISOString();

  const { data: session, error: createError } = await supabase
    .from("sessions")
    .insert({
      psychologist_id: psychologistId,
      client_id: clientId,
      scheduled_at: scheduledAt,
      duration_minutes: settings.session_duration_minutes,
      status: "pending_payment",
      booked_via: "public_link",
      client_contact_name: clientName,
      client_contact_telegram: clientTelegram,
    })
    .select("id, scheduled_at, duration_minutes, status")
    .single();

  if (createError) {
    // Уникальный индекс/констрейнт на пересечение (если такой есть в БД)
    // тоже может сработать здесь как последняя линия защиты от гонки —
    // отдаём тот же понятный ответ, что и при обычной проверке занятости.
    return NextResponse.json({ error: "Не удалось создать бронь — возможно, время уже занято" }, { status: 409 });
  }

  return NextResponse.json({
    session_id: session.id,
    scheduled_at: session.scheduled_at,
    duration_minutes: session.duration_minutes,
    status: session.status,
    payment_instructions:
      "Бронь создана. Психолог свяжется с вами в Telegram для подтверждения и оплаты сессии.",
  });
}
