import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TEST_SCALES, interpretScore, getMaxScore, type TestType } from "@/lib/testScales";

// POST /api/tests/create
// Body: { client_id: string, test_type: TestType, score?: number, answers?: object, session_id?: string, status?: "pending"|"completed" }
//
// Два сценария:
// 1. Психолог сразу вносит результат (score задан) — статус "completed",
//    interpretation считается автоматически по шкале.
// 2. Психолог отправляет тест клиенту "на дом" через мессенджер (score
//    ещё не известен) — создаётся запись status="pending", score=0,
//    её потом обновит отдельный флоу приёма ответа от клиента (сейчас
//    не реализован — заготовка на будущее, аналогично pending-сообщениям
//    в messages).
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: {
    client_id?: string;
    test_type?: string;
    score?: number;
    answers?: Record<string, unknown>;
    session_id?: string;
    status?: "pending" | "completed";
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  if (!body.client_id) {
    return NextResponse.json({ error: "Укажите client_id" }, { status: 400 });
  }
  const testType = body.test_type as TestType | undefined;
  if (!testType || !(testType in TEST_SCALES)) {
    return NextResponse.json(
      { error: `test_type должен быть одним из: ${Object.keys(TEST_SCALES).join(", ")}` },
      { status: 400 }
    );
  }

  // Клиент должен принадлежать текущему психологу — проверяем перед вставкой,
  // чтобы не полагаться только на RLS (даёт понятную ошибку 404 вместо 403 от Postgres).
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id")
    .eq("id", body.client_id)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (clientError) {
    return NextResponse.json({ error: clientError.message }, { status: 500 });
  }
  if (!client) {
    return NextResponse.json({ error: "Клиент не найден" }, { status: 404 });
  }

  const status = body.status ?? (body.score !== undefined ? "completed" : "pending");
  const maxScore = getMaxScore(testType);
  const score = body.score ?? 0;
  const interpretation = status === "completed" ? interpretScore(testType, score) : null;

  const { data, error } = await supabase
    .from("test_results")
    .insert({
      client_id: body.client_id,
      psychologist_id: user.id,
      session_id: body.session_id ?? null,
      test_type: testType,
      score,
      max_score: maxScore,
      answers: body.answers ?? null,
      interpretation,
      status,
    })
    .select("id, test_type, score, max_score, interpretation, status, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ test: data });
}
