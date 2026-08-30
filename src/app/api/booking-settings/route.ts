import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/slug";

// GET /api/booking-settings — настройки публичной записи текущего
// психолога (null, если ещё не создавались — на UI это означает
// "публичная запись пока не настроена").
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("booking_settings")
    .select(
      "id, public_slug, working_hours, session_duration_minutes, buffer_minutes, min_notice_hours, max_advance_days, is_active, created_at, updated_at"
    )
    .eq("psychologist_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ settings: data });
}

interface WorkingHoursInput {
  mon?: [string, string] | null;
  tue?: [string, string] | null;
  wed?: [string, string] | null;
  thu?: [string, string] | null;
  fri?: [string, string] | null;
  sat?: [string, string] | null;
  sun?: [string, string] | null;
}

interface BookingSettingsBody {
  working_hours?: WorkingHoursInput;
  session_duration_minutes?: number;
  buffer_minutes?: number;
  min_notice_hours?: number;
  max_advance_days?: number;
  is_active?: boolean;
}

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function validateWorkingHours(input: unknown): string | null {
  if (input === undefined) return null;
  if (typeof input !== "object" || input === null) return "working_hours должен быть объектом";
  const obj = input as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!DAY_KEYS.includes(key as (typeof DAY_KEYS)[number])) {
      return `Неизвестный день недели: ${key}`;
    }
    const value = obj[key];
    if (value === null) continue;
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== "string" ||
      typeof value[1] !== "string" ||
      !/^\d{2}:\d{2}$/.test(value[0]) ||
      !/^\d{2}:\d{2}$/.test(value[1])
    ) {
      return `${key} должен быть либо null (выходной), либо ["HH:MM","HH:MM"]`;
    }
  }
  return null;
}

/** Генерирует уникальный public_slug из имени психолога, добавляя число при коллизии. */
async function generateUniqueSlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  name: string
): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 1;
  // На бете psychologists — единицы-десятки, цикл коротким не будет.
  while (true) {
    const { data: existing } = await supabase
      .from("booking_settings")
      .select("id")
      .eq("public_slug", candidate)
      .maybeSingle();
    if (!existing) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

// POST/PUT /api/booking-settings — создать или обновить настройки.
// При первом создании public_slug генерируется автоматически из имени
// психолога (транслитерация + проверка уникальности) — тело запроса
// slug не принимает, чтобы не плодить дублирующую логику валидации
// формата ссылки на клиенте.
async function upsertHandler(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: BookingSettingsBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const workingHoursError = validateWorkingHours(body.working_hours);
  if (workingHoursError) {
    return NextResponse.json({ error: workingHoursError }, { status: 400 });
  }
  if (body.session_duration_minutes !== undefined && ![30, 50, 60, 90].includes(body.session_duration_minutes)) {
    return NextResponse.json({ error: "session_duration_minutes должен быть одним из: 30, 50, 60, 90" }, { status: 400 });
  }
  if (body.buffer_minutes !== undefined && ![0, 10, 15, 30].includes(body.buffer_minutes)) {
    return NextResponse.json({ error: "buffer_minutes должен быть одним из: 0, 10, 15, 30" }, { status: 400 });
  }
  if (body.min_notice_hours !== undefined && ![1, 2, 4, 24].includes(body.min_notice_hours)) {
    return NextResponse.json({ error: "min_notice_hours должен быть одним из: 1, 2, 4, 24" }, { status: 400 });
  }
  if (body.max_advance_days !== undefined && ![7, 14, 30, 60].includes(body.max_advance_days)) {
    return NextResponse.json({ error: "max_advance_days должен быть одним из: 7, 14, 30, 60" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("booking_settings")
    .select("id, public_slug")
    .eq("psychologist_id", user.id)
    .maybeSingle();

  const patch: Record<string, unknown> = {};
  if (body.working_hours !== undefined) patch.working_hours = body.working_hours;
  if (body.session_duration_minutes !== undefined) patch.session_duration_minutes = body.session_duration_minutes;
  if (body.buffer_minutes !== undefined) patch.buffer_minutes = body.buffer_minutes;
  if (body.min_notice_hours !== undefined) patch.min_notice_hours = body.min_notice_hours;
  if (body.max_advance_days !== undefined) patch.max_advance_days = body.max_advance_days;
  if (body.is_active !== undefined) patch.is_active = body.is_active;
  patch.updated_at = new Date().toISOString();

  if (existing) {
    const { data: updated, error: updateError } = await supabase
      .from("booking_settings")
      .update(patch)
      .eq("id", existing.id)
      .select(
        "id, public_slug, working_hours, session_duration_minutes, buffer_minutes, min_notice_hours, max_advance_days, is_active, updated_at"
      )
      .single();
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    return NextResponse.json({ settings: updated });
  }

  const metadataName = typeof user.user_metadata?.name === "string" ? user.user_metadata.name.trim() : "";
  const nameForSlug = metadataName || (user.email ? user.email.split("@")[0] : "psychologist");
  const publicSlug = await generateUniqueSlug(supabase, nameForSlug);

  const { data: created, error: createError } = await supabase
    .from("booking_settings")
    .insert({
      psychologist_id: user.id,
      public_slug: publicSlug,
      ...patch,
    })
    .select(
      "id, public_slug, working_hours, session_duration_minutes, buffer_minutes, min_notice_hours, max_advance_days, is_active, created_at, updated_at"
    )
    .single();
  if (createError) {
    return NextResponse.json({ error: createError.message }, { status: 500 });
  }
  return NextResponse.json({ settings: created });
}

export const POST = upsertHandler;
export const PUT = upsertHandler;
