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

  // Тянем и название методики из справочника: раньше отдавался только
  // test_type ('PRIKHOZHAN'), а фронт пытался найти подпись в TEST_SCALES,
  // где лежат лишь пять старых клинических шкал — на любой из 17 новых
  // методик карточка клиента падала с «Cannot read properties of
  // undefined (reading 'label')».
  const { data, error } = await supabase
    .from("test_results")
    .select("id, test_type, score, max_score, interpretation, status, created_at, test_questionnaires ( title )")
    .eq("client_id", clientId)
    .eq("psychologist_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const tests = (data ?? []).map(row => {
    const rel = row.test_questionnaires as { title?: string } | { title?: string }[] | null;
    const questionnaire = Array.isArray(rel) ? rel[0] : rel;
    return {
      id: row.id,
      test_type: row.test_type,
      score: row.score,
      max_score: row.max_score,
      interpretation: row.interpretation,
      status: row.status,
      created_at: row.created_at,
      title: questionnaire?.title ?? null,
    };
  });

  const completed = tests.filter(t => t.status === "completed");
  const lastTest = completed.length > 0 ? completed[completed.length - 1] : null;

  return NextResponse.json({
    tests,
    lastTest,
  });
}
