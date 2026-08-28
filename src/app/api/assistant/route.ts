import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  checkYandexGptEnv,
  yandexGptCompleteWithTools,
  YandexGptError,
  type YandexGptAnyMessage,
} from "@/lib/yandexgpt";
import {
  checkAssistantLimit,
  consumeAssistantLimit,
  limitExceededResponse,
} from "@/lib/assistantLimits";
import { AGENT_SYSTEM_PROMPT, AGENT_TOOLS, MAX_AGENT_ITERATIONS, toolNeedsConfirmation } from "@/lib/agent/tools";
import { executeAgentTool, AgentToolError } from "@/lib/agent/executor";
import { buildApproachContextBlock } from "@/lib/approaches";

// POST /api/assistant
// Body: { message: string, client_id?: string, session_id?: string, agent_session_id?: string }
//
// Агентский цикл с function calling (до MAX_AGENT_ITERATIONS итераций).
// Если модель запрашивает необратимое действие (create_session,
// send_message_to_client и т.д.) — цикл останавливается и возвращает
// { type: "confirmation_required", action, description }. Клиент должен
// показать психологу карточку подтверждения и вызвать
// /api/assistant/confirm с этим же action.
//
// Списание лимита: агентская задача (любая цепочка с хотя бы одним
// вызовом инструмента) = 3. Простой вопрос без вызова инструментов = 1.
export async function POST(request: NextRequest) {
  const envStatus = checkYandexGptEnv();
  if (!envStatus.configured) {
    return NextResponse.json(
      { error: `YandexGPT не настроен. Добавьте ключи в .env: ${envStatus.missing.join(", ")}` },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { message?: string; client_id?: string; session_id?: string; agent_session_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const userMessage = body.message?.trim();
  if (!userMessage) {
    return NextResponse.json({ error: "Укажите message" }, { status: 400 });
  }

  // Проверяем лимит по минимальной стоимости (normal=1) заранее — точная
  // стоимость (1 или 3) станет известна по факту наличия tool_calls,
  // списываем её после успешного завершения цикла.
  const limitCheck = await checkAssistantLimit(supabase, user.id, "normal");
  if (!limitCheck.allowed) {
    return NextResponse.json(limitExceededResponse(limitCheck.limit), { status: 429 });
  }

  // Контекст: если открыт из карточки клиента — подмешиваем его данные.
  let contextPrefix = "";
  if (body.client_id) {
    const { data: client } = await supabase
      .from("clients")
      .select("id, name, request, approach, status")
      .eq("id", body.client_id)
      .maybeSingle();
    if (client) {
      contextPrefix = `Контекст: открыта карточка клиента ${client.name} (id: ${client.id}, запрос: ${client.request ?? "—"}, подход: ${client.approach ?? "—"}).\n\n`;
    }
  }

  // Подмешиваем в системный промпт стиль ответов под подход психолога
  // (заполняется на онбординге, см. /api/onboarding). Если профиль ещё
  // не заполнен — блок просто пустой, поведение как раньше.
  const { data: psychologistProfile } = await supabase
    .from("psychologists")
    .select("approach, specialty, typical_client_request")
    .eq("id", user.id)
    .maybeSingle();

  const approachBlock = psychologistProfile ? buildApproachContextBlock(psychologistProfile) : "";
  const systemPrompt = approachBlock ? `${approachBlock}\n\n${AGENT_SYSTEM_PROMPT}` : AGENT_SYSTEM_PROMPT;

  const messages: YandexGptAnyMessage[] = [
    { role: "system", text: systemPrompt },
    { role: "user", text: contextPrefix + userMessage },
  ];

  let usedTools = false;
  let iterations = 0;
  let finalText: string | null = null;

  try {
    while (iterations < MAX_AGENT_ITERATIONS) {
      iterations += 1;
      const result = await yandexGptCompleteWithTools(messages, {
        model: "pro",
        tools: AGENT_TOOLS,
        temperature: 0.2,
      });

      if (result.text !== null) {
        finalText = result.text;
        break;
      }

      // Модель запросила вызов функций.
      const toolCalls = result.toolCalls ?? [];
      messages.push({
        role: "assistant",
        toolCallList: { toolCalls },
      });

      // Если хотя бы один из запрошенных вызовов требует подтверждения —
      // останавливаемся и просим психолога подтвердить именно его.
      // (Остальные toolCalls в этой же пачке, если были, отбрасываются —
      // модель перезапросит их в новой цепочке после confirm/отказа.)
      const confirmationCall = toolCalls.find(tc => toolNeedsConfirmation(tc.functionCall.name));
      if (confirmationCall) {
        // Действие ещё не выполнено (ждём подтверждения) — списываем
        // минимальную стоимость "агентская задача была начата".
        await consumeAssistantLimit(supabase, user.id, "agentTask");
        return NextResponse.json({
          type: "confirmation_required",
          action: {
            tool: confirmationCall.functionCall.name,
            arguments: confirmationCall.functionCall.arguments,
          },
          description: describeAction(confirmationCall.functionCall.name, confirmationCall.functionCall.arguments),
        });
      }

      usedTools = true;
      const toolResults: Array<{ functionResult: { name: string; content: string } }> = [];
      for (const call of toolCalls) {
        try {
          const output = await executeAgentTool(
            { supabase, psychologistId: user.id },
            call.functionCall.name,
            call.functionCall.arguments
          );
          toolResults.push({
            functionResult: { name: call.functionCall.name, content: JSON.stringify(output) },
          });
        } catch (e) {
          const message = e instanceof AgentToolError ? e.message : "Ошибка выполнения инструмента";
          toolResults.push({
            functionResult: { name: call.functionCall.name, content: JSON.stringify({ error: message }) },
          });
        }
      }
      messages.push({ role: "user", toolResultList: { toolResults } });
    }
  } catch (e) {
    const message = e instanceof YandexGptError ? e.message : "Не удалось получить ответ ассистента";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (finalText === null) {
    finalText = "Не удалось завершить обработку запроса за отведённое число шагов. Попробуйте переформулировать вопрос проще.";
  }

  // Сохраняем диалог.
  await saveAgentSession(supabase, user.id, body.agent_session_id, userMessage, finalText);

  // Списываем лимит по фактической стоимости.
  await consumeAssistantLimit(supabase, user.id, usedTools ? "agentTask" : "normal");

  return NextResponse.json({ message: finalText, actions_taken: usedTools });
}

function describeAction(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case "create_client":
      return `Создать клиента «${args.name ?? "?"}».`;
    case "update_client":
      return `Изменить данные клиента.`;
    case "create_session":
      return `Создать сессию на ${args.datetime ?? "?"}.`;
    case "cancel_session":
      return `Отменить сессию.`;
    case "send_message_to_client":
      return `Отправить клиенту сообщение: «${String(args.text ?? "").slice(0, 120)}».`;
    case "send_homework":
      return `Отправить клиенту домашнее задание.`;
    case "send_session_invite":
      return `Отправить клиенту ссылку на сессию.`;
    default:
      return `Выполнить действие: ${tool}.`;
  }
}

async function saveAgentSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
  psychologistId: string,
  agentSessionId: string | undefined,
  userMessage: string,
  assistantMessage: string
) {
  const newEntries = [
    { role: "user", text: userMessage, at: new Date().toISOString() },
    { role: "assistant", text: assistantMessage, at: new Date().toISOString() },
  ];

  if (agentSessionId) {
    const { data: existing } = await supabase
      .from("agent_sessions")
      .select("messages")
      .eq("id", agentSessionId)
      .maybeSingle();
    if (existing) {
      const prevMessages = Array.isArray(existing.messages) ? existing.messages : [];
      await supabase
        .from("agent_sessions")
        .update({ messages: [...prevMessages, ...newEntries] })
        .eq("id", agentSessionId);
      return;
    }
  }

  await supabase.from("agent_sessions").insert({
    psychologist_id: psychologistId,
    messages: newEntries,
  });
}
