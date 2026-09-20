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
import { AGENT_SYSTEM_PROMPT, AGENT_TOOLS, getReferenceOnlyTools, MAX_AGENT_ITERATIONS, toolNeedsConfirmation } from "@/lib/agent/tools";
import { executeAgentTool, AgentToolError } from "@/lib/agent/executor";
import { buildApproachContextBlock } from "@/lib/approaches";
import { normalizeTimeZone, formatTimeInTimeZone } from "@/lib/timezone";
import { getActivePromptAdditions, recordAssistantFeedback } from "@/lib/promptEvolution";
import { selectAssistantModel, isReferenceOnlyQuestion } from "@/lib/agent/modelSelection";
import { findCachedReferenceAnswer, saveReferenceAnswerToCache } from "@/lib/agent/referenceAnswerCache";
import { guardResponseText } from "@/lib/agent/responseGuard";
import { parsePseudoToolCall, unwrapPlainMessageEnvelope } from "@/lib/agent/pseudoToolCallParser";
import { randomUUID } from "crypto";
import { waitUntil } from "@vercel/functions";

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
  const userId = user.id;

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
      .eq("psychologist_id", user.id)
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
    .select("approach, specialty, typical_client_request, timezone")
    .eq("id", user.id)
    .maybeSingle();

  const approachBlock = psychologistProfile ? buildApproachContextBlock(psychologistProfile) : "";

  // prompt_additions — динамическая стилевая добавка по approach,
  // выработанная автоматикой самоулучшения (см. lib/promptEvolution.ts
  // и migration_009). Пока cron-анализ не запущен, для всех approach
  // активной версии ещё нет — additions пустой, промпт не меняется.
  // Важно: это ДОБАВКА поверх неизменного AGENT_SYSTEM_PROMPT, а не
  // его замена — сам base-промпт (этика, безопасность, структура
  // ответа) автоматика никогда не трогает.
  const { text: promptAdditions, promptVersionId } = await getActivePromptAdditions(
    supabase,
    psychologistProfile?.approach ?? null
  );

  // Текущая дата/время психолога — без этого модель не может надёжно
  // посчитать "завтра", "через час", "в пятницу" и т.п. при вызове
  // create_session/find_available_slots (обучающие данные не содержат
  // сегодняшнюю дату).
  //
  // БЫЛО: now.toLocaleDateString/toLocaleTimeString без timeZone — то
  // есть в часовом поясе СЕРВЕРА (Vercel, регион fra1 = UTC), а не
  // психолога. У psychologists.timezone уже есть значение (миграция 023),
  // этот код просто не был обновлён вслед за ней. Психолог из Омска
  // (UTC+3 к серверу), попросивший поздно вечером «запланируй на
  // завтра», получил бы сессию на день раньше, чем ожидал — у сервера
  // календарная дата ещё не сменилась.
  const now = new Date();
  const timeZone = normalizeTimeZone(psychologistProfile?.timezone);
  const weekdayLabel = new Intl.DateTimeFormat("ru", { timeZone, weekday: "long" }).format(now);
  const dateLabel = new Intl.DateTimeFormat("ru", { timeZone, year: "numeric", month: "long", day: "numeric" }).format(now);
  const timeLabel = formatTimeInTimeZone(now, timeZone);
  const dateTimeBlock = `Текущая дата и время психолога (часовой пояс ${timeZone}): ${weekdayLabel}, ${dateLabel}, ${timeLabel} (ISO: ${now.toISOString()}). Используй это как точку отсчёта для "завтра", "через неделю", "в пятницу" и подобных относительных формулировок времени — никогда не угадывай и не бери дату из своих обучающих данных.`;

  // Порядок блоков подобран под кэширование промпта: провайдеры
  // кэшируют общий ПРЕФИКС, поэтому всё стабильное идёт вперёд, а
  // изменчивое — в самый конец.
  //
  // approachBlock меняется, только если психолог сменил подход в
  // профиле; AGENT_SYSTEM_PROMPT неизменен; promptAdditions меняется не
  // чаще запуска cron-анализа. А вот dateTimeBlock содержит время с
  // точностью до минуты — то есть у каждого запроса он свой. Пока он
  // стоял третьим, всё, что шло после него, не могло попасть в кэш: по
  // счетам за 15.09 входящие токены стоили 19,67 руб против 10,64 руб
  // кэшированных. Перенос в конец оставляет кэшируемым весь стабильный
  // префикс.
  const systemPrompt = [approachBlock, AGENT_SYSTEM_PROMPT, promptAdditions, dateTimeBlock].filter(Boolean).join("\n\n");

  // Подгружаем историю переписки этой agent_session — без этого каждое
  // сообщение психолога обрабатывается моделью в полном отрыве от
  // предыдущих реплик (например, «найди его по имени» без контекста,
  // о ком вообще шла речь). Берём только последние сообщения, чтобы не
  // раздувать промпт — токены tool-вызовов внутри одного хода сюда не
  // попадают, только финальные реплики user/assistant.
  const MAX_HISTORY_MESSAGES = 12;
  const history: YandexGptAnyMessage[] = [];
  if (body.agent_session_id) {
    const { data: existingSession } = await supabase
      .from("agent_sessions")
      .select("messages")
      .eq("id", body.agent_session_id)
      .eq("psychologist_id", user.id)
      .maybeSingle();
    const prevMessages = Array.isArray(existingSession?.messages) ? existingSession.messages : [];
    for (const entry of prevMessages.slice(-MAX_HISTORY_MESSAGES) as Array<{ role: string; text: string }>) {
      if (entry.role === "user" || entry.role === "assistant") {
        history.push({ role: entry.role, text: entry.text });
      }
    }
  }

  // Модель выбирается ОДИН РАЗ, до входа в цикл, по дешёвой текстовой
  // эвристике (без сети) — и используется на всех итерациях. См.
  // lib/agent/modelSelection.ts про то, почему это безопаснее ранее
  // откаченного каскада lite→pro (тот выбирал модель ПОСЛЕ первого
  // ответа, что означало до двух сетевых вызовов на один запрос).
  const selectedModel = selectAssistantModel(userMessage, history.length > 0);

  // Набор инструментов, доступных модели — независимо от того, какая
  // модель выбрана. Для справочных вопросов о платформе (та же
  // эвристика, что и в selectAssistantModel, но это отдельное решение —
  // см. комментарий у isReferenceOnlyQuestion) передаём только
  // search_knowledge_base и find_client_by_name вместо полной схемы
  // из 18 инструментов: остальные 16 физически не могут понадобиться
  // психологу, который спрашивает "как поменять часовой пояс", а схема
  // function calling — это ощутимая часть стоимости каждого запроса
  // (см. комментарий у AGENT_TOOLS про точный размер). Психолог получает
  // тот же ответ, просто модель тратит меньше на описание инструментов,
  // которые ей всё равно не понадобятся для этого вопроса.
  const isReferenceOnly = isReferenceOnlyQuestion(userMessage);
  const availableTools = isReferenceOnly ? getReferenceOnlyTools() : AGENT_TOOLS;

  // Семантический кэш — ТОЛЬКО для справочных вопросов о платформе (см.
  // referenceAnswerCache.ts про экономику и почему для вопросов о данных
  // клиента кэш недопустим в принципе). При попадании полностью пропускаем
  // LLM-вызов, но психолог всё равно получает ответ, диалог сохраняется,
  // а лимит списывается как за обычный запрос — с точки зрения психолога
  // это не отличимо от обычного ответа, дешевле только для платформы.
  if (isReferenceOnly) {
    const cached = await findCachedReferenceAnswer(supabase, userMessage);
    if (cached) {
      const assistantMessageId = randomUUID();
      const { agentSessionId } = await saveAgentSession(
        supabase,
        user.id,
        body.agent_session_id,
        userMessage,
        cached.answer,
        assistantMessageId
      );
      await consumeAssistantLimit(supabase, user.id, "normal");
      await recordAssistantFeedback(supabase, {
        psychologistId: user.id,
        approach: psychologistProfile?.approach ?? null,
        agentSessionId,
        messageId: assistantMessageId,
        question: userMessage,
        answer: cached.answer,
        promptVersionId,
      });
      return NextResponse.json({
        message: cached.answer,
        actions_taken: false,
        agent_session_id: agentSessionId,
        message_id: assistantMessageId,
      });
    }
  }

  const messages: YandexGptAnyMessage[] = [
    { role: "system", text: systemPrompt },
    ...history,
    { role: "user", text: contextPrefix + userMessage },
  ];

  let usedTools = false;
  let iterations = 0;
  let finalText: string | null = null;

  // Возвращает NextResponse, если цикл должен немедленно остановиться
  // (нужно подтверждение психолога); { shortCircuitText } если результат
  // инструмента уже самодостаточен как финальный ответ психологу (см.
  // ниже про get_period_summary); иначе null и продолжает messages для
  // следующей итерации. Вынесено в функцию, чтобы не дублировать одну и
  // ту же обработку toolCalls в двух местах цикла (см. ниже, где lite
  // неожиданно тоже запрашивает tool call).
  async function handleToolCalls(
    toolCalls: NonNullable<Awaited<ReturnType<typeof yandexGptCompleteWithTools>>["toolCalls"]>
  ): Promise<NextResponse | { shortCircuitText: string } | null> {
    messages.push({ role: "assistant", toolCallList: { toolCalls } });

    // Если хотя бы один из запрошенных вызовов требует подтверждения —
    // останавливаемся и просим психолога подтвердить именно его.
    // (Остальные toolCalls в этой же пачке, если были, отбрасываются —
    // модель перезапросит их в новой цепочке после confirm/отказа.)
    const confirmationCall = toolCalls.find(tc => toolNeedsConfirmation(tc.functionCall.name));
    if (confirmationCall) {
      // Действие ещё не выполнено (ждём подтверждения) — списываем
      // минимальную стоимость "агентская задача была начата".
      await consumeAssistantLimit(supabase, userId, "agentTask");
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
    let periodSummaryShortCircuitText: string | null = null;
    for (const call of toolCalls) {
      try {
        const output = await executeAgentTool(
          { supabase, psychologistId: userId, timeZone },
          call.functionCall.name,
          call.functionCall.arguments
        );
        toolResults.push({
          functionResult: { name: call.functionCall.name, content: JSON.stringify(output) },
        });
        // Экономия лишней LLM-итерации (см. задачу "рычаг 1", 20.09):
        // get_period_summary уже возвращает полностью готовый,
        // структурированный текст (summaryText из buildPeriodSummary) —
        // без дальнейшей интерпретации моделью, промпт среза не
        // подмешивает персонализацию под подход психолога, так что
        // следующая LLM-итерация с полной схемой из 18 инструментов
        // тратилась бы только на то, чтобы пересказать тот же текст
        // другими словами. Срабатывает, только если это ЕДИНСТВЕННЫЙ
        // вызов в пачке — если модель запросила ещё что-то в этой же
        // пачке, ей может быть нужно скомбинировать результаты, тогда
        // идём обычным путём через ещё одну итерацию.
        if (
          call.functionCall.name === "get_period_summary" &&
          toolCalls.length === 1 &&
          output &&
          typeof output === "object" &&
          "summary" in output &&
          typeof (output as { summary: unknown }).summary === "string"
        ) {
          periodSummaryShortCircuitText = (output as { summary: string }).summary;
        }
      } catch (e) {
        const message = e instanceof AgentToolError ? e.message : "Ошибка выполнения инструмента";
        toolResults.push({
          functionResult: { name: call.functionCall.name, content: JSON.stringify({ error: message }) },
        });
      }
    }

    if (periodSummaryShortCircuitText !== null) {
      return { shortCircuitText: periodSummaryShortCircuitText };
    }

    messages.push({ role: "user", toolResultList: { toolResults } });
    return null;
  }

  try {
    while (iterations < MAX_AGENT_ITERATIONS) {
      iterations += 1;

      // selectedModel выбран заранее (см. выше) и не меняется между
      // итерациями — ровно один сетевой вызов к YandexGPT на итерацию,
      // независимо от того, lite это или pro. Прошлый каскад (lite на
      // первой итерации → pro, если lite запросил tool call) приводил
      // к ДВУМ последовательным сетевым вызовам в рамках одной
      // serverless-функции и превышал таймаут Vercel — здесь такого
      // сценария нет в принципе.
      const result = await yandexGptCompleteWithTools(messages, {
        model: selectedModel,
        tools: availableTools,
        temperature: 0.2,
      });

      if (result.text !== null) {
        // Некоторые модели (подтверждено на Pro 5.1, см.
        // lib/agent/pseudoToolCallParser.ts) иногда вместо заполнения
        // structured toolCallList.toolCalls пишут текстовое подобие
        // вызова инструмента прямо в текст ответа. Раньше это уходило
        // психологу как сломанный "финальный" ответ (перехватывался
        // только responseGuard'ом — который ПРЯЧЕТ проблему fallback-
        // текстом, а не решает её). Теперь сначала пробуем распознать
        // и обработать это как настоящий tool call — психолог в
        // успешном случае вообще не видит разницы. Если распознавание
        // не сработало, работаем с текстом как раньше (см. ниже,
        // включая responseGuard как последний барьер).
        const pseudoCall = parsePseudoToolCall(result.text);
        if (pseudoCall) {
          // Постоянное (не временное) логирование — нужно для мониторинга
          // реальной частоты срабатывания на живых данных бета-тестеров
          // (не только на сегодняшних провокационных тестах). Не включает
          // сырой текст ответа (в отличие от снятого временного лога
          // RESPONSE_GUARD_BLOCKED_RAW) — только факт и какой инструмент
          // был распознан, этого достаточно для отслеживания частоты без
          // риска логировать фрагменты данных клиента.
          console.log("PSEUDO_TOOL_CALL_INTERCEPTED", JSON.stringify({ model: selectedModel, tool: pseudoCall.name }));
          const stopResponse = await handleToolCalls([
            { functionCall: { name: pseudoCall.name, arguments: pseudoCall.arguments } },
          ]);
          if (stopResponse instanceof NextResponse) return stopResponse;
          if (stopResponse) {
            finalText = stopResponse.shortCircuitText;
            break;
          }
          continue;
        }

        // Отдельный (не tool-call) баг того же семейства, найденный
        // 20.09 при проверке ложных срабатываний: модель иногда
        // оборачивает обычный текстовый ответ в JSON-конверт
        // {"role":"assistant","message":"<текст>"} без всякого
        // намерения вызвать инструмент — см. unwrapPlainMessageEnvelope.
        // Распаковываем и используем сам текст как финальный ответ,
        // вместо того чтобы показывать психологу сырой JSON.
        const unwrapped = unwrapPlainMessageEnvelope(result.text);
        finalText = unwrapped ?? result.text;
        break;
      }

      // Модель запросила вызов функций.
      const stopResponse = await handleToolCalls(result.toolCalls ?? []);
      if (stopResponse instanceof NextResponse) return stopResponse;
      if (stopResponse) {
        finalText = stopResponse.shortCircuitText;
        break;
      }
    }
  } catch (e) {
    const message = e instanceof YandexGptError ? e.message : "Не удалось получить ответ ассистента";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const iterationsExhausted = finalText === null;
  const rawResponseText: string = iterationsExhausted
    ? "Не удалось завершить обработку запроса за отведённое число шагов. Попробуйте переформулировать вопрос проще."
    : (finalText as string);

  // Последний барьер перед тем, как психолог увидит ответ — см.
  // lib/agent/responseGuard.ts про то, почему это НЕ дублирует правила
  // системного промпта, а защищает от случаев, когда модель (любая, не
  // только Pro 5.1) их не соблюла. Применяется здесь, ДО сохранения в
  // agent_sessions/кэш и ДО ответа психологу — так небезопасный текст
  // никогда никуда не попадает, а не только не показывается в UI.
  const responseText = guardResponseText(rawResponseText);

  // Сохраняем диалог. assistantMessageId — стабильный id именно этого
  // ответа ассистента (сохраняется вместе с сообщением в jsonb), нужен
  // как FK для явного/неявного фидбека психолога по конкретному ответу.
  const assistantMessageId = randomUUID();
  const { agentSessionId } = await saveAgentSession(
    supabase,
    user.id,
    body.agent_session_id,
    userMessage,
    responseText,
    assistantMessageId
  );

  // Списываем лимит по фактической стоимости.
  await consumeAssistantLimit(supabase, user.id, usedTools ? "agentTask" : "normal");

  // Обратная связь по approach — вспомогательная аналитика для
  // самоулучшения ассистента (см. lib/promptEvolution.ts), не должна
  // задерживать ответ психологу дольше необходимого, но и не должна
  // теряться, поэтому просто await, а не fire-and-forget: сам insert
  // лёгкий, а ошибки внутри уже проглатываются и логируются.
  await recordAssistantFeedback(supabase, {
    psychologistId: user.id,
    approach: psychologistProfile?.approach ?? null,
    agentSessionId,
    messageId: assistantMessageId,
    question: userMessage,
    answer: responseText,
    promptVersionId,
  });

  // Сохраняем в семантический кэш ТОЛЬКО справочные вопросы (см.
  // referenceAnswerCache.ts) — не блокируем ОТВЕТ психологу ожиданием
  // этого запроса, но и не используем голый "void fire-and-forget":
  // на серверлес-рантайме Vercel платформа вправе заморозить/убить
  // execution context сразу после того, как обработчик вернул ответ —
  // любой незавершённый await (здесь их два подряд: сначала сетевой
  // вызов YandexGPT Embeddings, потом Supabase insert) обрывается
  // молча, ДО того как успевает сработать даже catch/console.error
  // внутри saveReferenceAnswerToCache. Это и было настоящей причиной
  // того, что кэш не сохранял вообще ничего (таблица оставалась
  // пустой без единой строки в логах об ошибке) — a не найденная
  // ранее асимметрия doc/query эмбеддингов (та тоже была реальной
  // проблемой и исправлена отдельно, но не она была причиной пустой
  // таблицы). waitUntil() из @vercel/functions — официальный способ
  // явно продлить жизнь serverless-инстанса до завершения промиса,
  // даже после того как ответ уже отправлен клиенту. Не кэшируем
  // деградированный ответ "не удалось завершить обработку" — это
  // ошибка выполнения, а не факт о платформе.
  if (isReferenceOnly && !iterationsExhausted) {
    waitUntil(saveReferenceAnswerToCache(supabase, userMessage, responseText));
  }

  return NextResponse.json({
    message: responseText,
    actions_taken: usedTools,
    agent_session_id: agentSessionId,
    message_id: assistantMessageId,
  });
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
    case "send_broadcast_message":
      return `Разослать сообщение всем активным клиентам: «${String(args.text ?? "").slice(0, 120)}».`;
    default:
      return `Выполнить действие: ${tool}.`;
  }
}

async function saveAgentSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
  psychologistId: string,
  agentSessionId: string | undefined,
  userMessage: string,
  assistantMessage: string,
  assistantMessageId: string
): Promise<{ agentSessionId: string | null }> {
  // id у user-реплики тоже нужен (хоть пока и не используется как FK
  // нигде явно) — для единообразия формата записей в jsonb и на случай
  // будущего фидбека по вопросам психолога, а не только по ответам.
  const newEntries = [
    { id: randomUUID(), role: "user", text: userMessage, at: new Date().toISOString() },
    { id: assistantMessageId, role: "assistant", text: assistantMessage, at: new Date().toISOString() },
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
      return { agentSessionId };
    }
  }

  const { data: inserted } = await supabase
    .from("agent_sessions")
    .insert({
      psychologist_id: psychologistId,
      messages: newEntries,
    })
    .select("id")
    .maybeSingle();

  return { agentSessionId: inserted?.id ?? null };
}
