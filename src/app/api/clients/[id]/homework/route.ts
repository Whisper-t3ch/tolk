import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { executeAgentTool, AgentToolError } from "@/lib/agent/executor";

// POST /api/clients/[id]/homework
// Body: { homework_text: string }
//
// Прямая отправка домашнего задания конкретному клиенту из UI (вкладка
// "Шаблоны ДЗ" в разделе База знаний, кнопка "Использовать") — в отличие
// от send_homework как agent tool, здесь психолог сам явно выбрал
// клиента и текст, LLM/ассистент не нужен и не должен участвовать в
// этом простом действии. Переиспользует ту же логику доставки, что и
// агентский цикл (tryDeliverMessage внутри executeAgentTool), чтобы не
// дублировать код отправки в двух местах.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { homework_text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const homeworkText = body.homework_text?.trim();
  if (!homeworkText) {
    return NextResponse.json({ error: "Укажите homework_text" }, { status: 400 });
  }

  // Проверяем, что клиент принадлежит текущему психологу — executor сам
  // не делает эту проверку (в агентском цикле это гарантируется RLS на
  // supabase-клиенте с сессией психолога), но здесь для ясности и
  // единообразия с другими прямыми route'ами проверяем явно.
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (clientError) {
    return NextResponse.json({ error: clientError.message }, { status: 500 });
  }
  if (!client) {
    return NextResponse.json({ error: "Клиент не найден" }, { status: 404 });
  }

  try {
    const result = await executeAgentTool(
      { supabase, psychologistId: user.id },
      "send_homework",
      { client_id: clientId, homework_text: homeworkText }
    );
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof AgentToolError ? e.message : "Не удалось отправить домашнее задание";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
