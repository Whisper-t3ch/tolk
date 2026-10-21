import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { executeAgentTool, AgentToolError } from "@/lib/agent/executor";
import { toolNeedsConfirmation } from "@/lib/agent/tools";
import { normalizeTimeZone } from "@/lib/timezone";
import { describeSuccess } from "@/lib/agent/describeAction";
import { randomUUID } from "crypto";

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

  let body: { action?: { tool?: string; arguments?: Record<string, unknown> }; confirmed?: boolean; agent_session_id?: string };
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

  // Результат подтверждения дописываем в историю чата, чтобы после перезагрузки диалог читался целиком.
  const appendToHistory = async (text: string) => {
    if (!body.agent_session_id) return;
    try {
      const { data: row } = await supabase
        .from("agent_sessions")
        .select("messages")
        .eq("id", body.agent_session_id)
        .eq("psychologist_id", user.id)
        .maybeSingle();
      if (!row) return;
      const prev = Array.isArray(row.messages) ? row.messages : [];
      await supabase
        .from("agent_sessions")
        .update({ messages: [...prev, { id: randomUUID(), role: "assistant", text, at: new Date().toISOString() }] })
        .eq("id", body.agent_session_id)
        .eq("psychologist_id", user.id);
    } catch {
      // история — вспомогательная, на результат действия не влияет
    }
  };

  if (body.confirmed !== true) {
    await appendToHistory("Хорошо, отменяю.");
    return NextResponse.json({ message: "Хорошо, отменяю." });
  }

  if (!toolNeedsConfirmation(tool)) {
    // Защита от произвольного вызова любого инструмента через confirm —
    // этот route предназначен только для действий из CONFIRMATION_REQUIRED_TOOLS.
    return NextResponse.json({ error: "Этот инструмент не требует подтверждения через этот route" }, { status: 400 });
  }

  try {
    // Пояс психолога нужен инструментам, которые сами считают время
    // (find_available_slots) — см. задачу про executor.ts::findAvailableSlots.
    const { data: psychologist } = await supabase
      .from("psychologists")
      .select("timezone")
      .eq("id", user.id)
      .maybeSingle();
    const timeZone = normalizeTimeZone(psychologist?.timezone as string | undefined);

    const ctx = { supabase, psychologistId: user.id, timeZone };
    const { then_session: thenSession, ...mainArgs } = args as Record<string, unknown>;
    const output = await executeAgentTool(ctx, tool, tool === "create_client" ? mainArgs : args);
    let message = describeSuccess(tool, output, timeZone);
    // «Создай клиента и сразу поставь сессию»: вторым шагом — сессия уже созданного клиента.
    if (tool === "create_client" && thenSession && typeof thenSession === "object") {
      const created = (output as { clients?: Array<{ id?: string }> })?.clients?.[0]?.id;
      if (created) {
        try {
          const sessionOutput = await executeAgentTool(ctx, "create_session", { ...(thenSession as Record<string, unknown>), client_id: created });
          message += `\n${describeSuccess("create_session", sessionOutput, timeZone)}`;
        } catch (e) {
          message += `\nНо сессию поставить не получилось: ${e instanceof AgentToolError ? e.message : "ошибка"}. Напишите, когда поставить, и я повторю.`;
        }
      }
    }
    await appendToHistory(message);
    return NextResponse.json({ message, result: output });
  } catch (e) {
    const message = e instanceof AgentToolError ? e.message : "Не удалось выполнить действие";
    await appendToHistory(`Не получилось: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
