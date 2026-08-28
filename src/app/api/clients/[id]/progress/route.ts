import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/clients/[id]/progress
// Возвращает точки client_progress клиента, отсортированные по времени —
// используется для графика общего прогресса (отдельно от конкретных
// тестовых шкал, см. /api/clients/[id]/tests).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("client_progress")
    .select("id, metric_type, value, note, recorded_at")
    .eq("client_id", clientId)
    .eq("psychologist_id", user.id)
    .order("recorded_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ progress: data ?? [] });
}

// POST /api/clients/[id]/progress
// Body: { metric_type: "anxiety"|"depression"|"wellbeing"|"general", value: number, note?: string }
// Ручная точка прогресса — например, психолог хочет зафиксировать
// субъективную оценку состояния клиента без привязки к конкретному тесту.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { metric_type?: string; value?: number; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const validMetrics = ["anxiety", "depression", "wellbeing", "general"];
  if (!body.metric_type || !validMetrics.includes(body.metric_type)) {
    return NextResponse.json({ error: `metric_type должен быть одним из: ${validMetrics.join(", ")}` }, { status: 400 });
  }
  if (typeof body.value !== "number") {
    return NextResponse.json({ error: "Укажите числовое value" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("client_progress")
    .insert({
      client_id: clientId,
      psychologist_id: user.id,
      metric_type: body.metric_type,
      value: body.value,
      note: body.note ?? null,
    })
    .select("id, metric_type, value, note, recorded_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ progress: data });
}
