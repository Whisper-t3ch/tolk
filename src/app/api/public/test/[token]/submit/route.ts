import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scoreQuestionnaire, type QuestionnaireSchema } from "@/lib/testQuestionnaires";

// POST /api/public/test/[token]/submit
// Body: { answers: Record<string, number> }
//
// Публичный роут — БЕЗ авторизации. Принимает ответы клиента, считает
// балл по ключу опросника (test_questionnaires.schema, включая
// reverse-вопросы и субшкалы — см. src/lib/testQuestionnaires.ts) и
// обновляет test_results на status="completed". Токен одноразовый —
// повторная отправка на уже завершённый тест отклоняется, чтобы
// клиент не мог случайно/намеренно переписать результат.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = createAdminClient();

  let body: { answers?: Record<string, number> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }
  if (!body.answers || typeof body.answers !== "object") {
    return NextResponse.json({ error: "Не переданы ответы" }, { status: 400 });
  }

  const { data: testResult, error: testError } = await supabase
    .from("test_results")
    .select("id, status, questionnaire_key")
    .eq("access_token", token)
    .maybeSingle();
  if (testError) return NextResponse.json({ error: testError.message }, { status: 500 });
  if (!testResult) return NextResponse.json({ error: "Тест не найден — проверьте ссылку" }, { status: 404 });
  if (testResult.status === "completed") {
    return NextResponse.json({ error: "Этот тест уже пройден" }, { status: 409 });
  }

  const { data: questionnaire, error: qError } = await supabase
    .from("test_questionnaires")
    .select("schema")
    .eq("test_key", testResult.questionnaire_key)
    .maybeSingle();
  if (qError) return NextResponse.json({ error: qError.message }, { status: 500 });
  if (!questionnaire) return NextResponse.json({ error: "Опросник не найден" }, { status: 404 });

  let result;
  try {
    result = scoreQuestionnaire(questionnaire.schema as QuestionnaireSchema, body.answers);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Не удалось посчитать результат — проверьте, что отвечены все вопросы" },
      { status: 400 }
    );
  }

  const { error: updateError } = await supabase
    .from("test_results")
    .update({
      score: result.score,
      max_score: result.maxScore,
      interpretation: result.interpretation,
      answers: { raw: body.answers, subscales: result.subscaleScores ?? null },
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", testResult.id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({
    score: result.score,
    maxScore: result.maxScore,
    interpretation: result.interpretation,
  });
}
