import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { executeAgentTool, AgentToolError } from "@/lib/agent/executor";
import { toolNeedsConfirmation } from "@/lib/agent/tools";

// POST /api/assistant/confirm
// Body: { action: { tool: string, arguments: Record<string, unknown> }, confirmed: boolean }
//
// Выполняет (или отменяет) необратимое действие, которое агент
// запросил через /api/assistant (ответ типа confirmation_required).
// Не расходует лимит ассистента отдельно — стоимость уже списана
// на шаге, где действие было предложено.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { action?: { tool?: string; arguments?: Record<string, unknown> }; confirmed?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const tool = body.action?.tool;
  const args = body.action?.arguments ?? {};
  if (!tool) {
    return NextResponse.json({ error: "Укажите action.tool" }, { status: 400 });
  }

  if (body.confirmed !== true) {
    return NextResponse.json({ message: "Хорошо, отменяю." });
  }

  if (!toolNeedsConfirmation(tool)) {
    // Защита от произвольного вызова любого инструмента через confirm —
    // этот route предназначен только для действий из CONFIRMATION_REQUIRED_TOOLS.
    return NextResponse.json({ error: "Этот инструмент не требует подтверждения через этот route" }, { status: 400 });
  }

  try {
    const output = await executeAgentTool({ supabase, psychologistId: user.id }, tool, args);
    return NextResponse.json({ message: describeSuccess(tool), result: output });
  } catch (e) {
    const message = e instanceof AgentToolError ? e.message : "Не удалось выполнить действие";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function describeSuccess(tool: string): string {
  switch (tool) {
    case "create_client":
      return "Клиент создан.";
    case "update_client":
      return "Данные клиента обновлены.";
    case "create_session":
      return "Сессия создана.";
    case "cancel_session":
      return "Сессия отменена.";
    case "send_message_to_client":
      return "Сообщение подготовлено и сохранено. Отправка в мессенджер будет доступна после подключения каналов.";
    case "send_homework":
      return "Домашнее задание подготовлено и сохранено. Отправка в мессенджер будет доступна после подключения каналов.";
    case "send_session_invite":
      return "Приглашение подготовлено и сохранено. Отправка будет доступна после подключения каналов и видеосвязи.";
    default:
      return "Готово.";
  }
}
