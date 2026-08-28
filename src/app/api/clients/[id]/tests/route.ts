import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/clients/[id]/tests
// Возвращает историю тестов клиента (для графика динамики и списка
// последних результатов), только завершённые (status = 'completed'),
// от старых к новым — удобно сразу для recharts LineChart.
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
    .from("test_results")
    .select("id, test_type, score, max_score, interpretation, status, created_at")
    .eq("client_id", clientId)
    .eq("psychologist_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const completed = (data ?? []).filter(t => t.status === "completed");
  const lastTest = completed.length > 0 ? completed[completed.length - 1] : null;

  return NextResponse.json({
    tests: data ?? [],
    lastTest,
  });
}
