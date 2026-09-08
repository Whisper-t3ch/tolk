import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/public/test/[token]
// Публичный роут — БЕЗ авторизации, клиент открывает по ссылке,
// присланной психологом. Использует createAdminClient() (service
// role), т.к. у клиента физически нет аккаунта/сессии — так же, как
// /api/public/booking/[slug]/slots. Отдаёт только то, что нужно для
// отображения формы: вопросы, шкалу ответов, инструкцию — НЕ ключи
// подсчёта (reverse/scoring/ranges), чтобы клиент не видел, как
// считается интерпретация.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: testResult, error: testError } = await supabase
    .from("test_results")
    .select("id, status, questionnaire_key, created_at")
    .eq("access_token", token)
    .maybeSingle();
  if (testError) return NextResponse.json({ error: testError.message }, { status: 500 });
  if (!testResult) return NextResponse.json({ error: "Тест не найден — проверьте ссылку" }, { status: 404 });

  if (testResult.status === "completed") {
    return NextResponse.json({ status: "completed" });
  }

  const { data: questionnaire, error: qError } = await supabase
    .from("test_questionnaires")
    .select("test_key, title, instructions, schema")
    .eq("test_key", testResult.questionnaire_key)
    .maybeSingle();
  if (qError) return NextResponse.json({ error: qError.message }, { status: 500 });
  if (!questionnaire) return NextResponse.json({ error: "Опросник не найден" }, { status: 404 });

  const schema = questionnaire.schema as {
    type?: "likert" | "ranking";
    responseScale?: unknown;
    questions?: Array<{ id: string; text: string; responseScale?: unknown }>;
    rankingItems?: Array<{ id: string; text: string }>;
    rankingGroups?: Array<{ key: string; label: string; items: Array<{ id: string; text: string }> }>;
  };

  if (schema.type === "ranking") {
    // Ranking-опросник (например, ценностные ориентации Рокича) — клиент
    // расставляет пункты по порядку значимости, а не отвечает по шкале.
    // Ключи подсчёта здесь не нужно скрывать — итог это сам порядок.
    return NextResponse.json({
      status: "pending",
      type: "ranking",
      title: questionnaire.title,
      instructions: questionnaire.instructions,
      rankingGroups: schema.rankingGroups ?? (schema.rankingItems ? [{ key: "default", label: "", items: schema.rankingItems }] : []),
    });
  }

  const questions = (schema.questions ?? []).map(q => ({
    id: q.id,
    text: q.text,
    responseScale: q.responseScale ?? schema.responseScale,
  }));

  // Отдаём вопросы без reverse/subscale/scoring/ranges — клиенту это не нужно,
  // а reverse-ключи имеет смысл скрывать (не должны влиять на честность ответа,
  // но и незачем их показывать).
  return NextResponse.json({
    status: "pending",
    type: "likert",
    title: questionnaire.title,
    instructions: questionnaire.instructions,
    responseScale: schema.responseScale ?? null,
    questions,
  });
}
