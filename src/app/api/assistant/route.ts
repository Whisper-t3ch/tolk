import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  checkYandexGptEnv,
  yandexGptCompleteWithTools,
  YandexGptError,
  type YandexGptAnyMessage,
  type YandexGptTool,
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
import { logLlmUsage } from "@/lib/agent/usageLog";
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
  // Domain routing (lib/agent/toolRouting.ts) — ОТКАЧЕНО 20.09, второй
  // заход подряд. Живой тест на составном вопросе "как менялась злость
  // у Кати и отправь ей домашнее задание по итогам" определил только
  // домен communication (ключевое слово "отправь"), потому что "злость"
  // не входит в keyword-список домена history (там только "тревог",
  // "динамик" и подобные общие термины) — search_client_history не
  // попал в урезанный набор из 4 инструментов, и модель не смогла
  // выполнить первую половину запроса, ответив "минуту..." без единого
  // вызова инструмента (actions_taken: false). Это ровно критерий
  // отката, согласованный заранее: любой случай, где routing не даёт
  // модели нужный инструмент — механизм отключается целиком, а не
  // чинится точечным добавлением ключевых слов (список эмоций,
  // симптомов и клинических тем, которые психолог может упомянуть,
  // принципиально неисчерпаем — сегодня не хватило "злости", завтра не
  // хватит другого слова). toolRouting.ts оставлен в репозитории для
  // истории/справки, но не используется.
  // Embedding retrieval для выбора инструментов (Уровень 2.4, 21.09) —
  // ТРЕТЬЯ попытка сузить набор из 18 инструментов, и первая через
  // семантическую близость (та же embedding-модель, что уже используется
  // для RAG по транскриптам), а не через жёсткие keyword-правила, как
  // в отменённом domain routing выше.
  //
  // ОТКАЧЕНО 21.09 — третий подряд провал того же намерения (сузить набор
  // динамически). Живой тест: "Отправь Кате ссылку на завтрашнюю
  // видеосессию" (реальная будущая сессия, однозначная формулировка) —
  // send_session_invite отсутствовал в narrowed списке из 7 инструментов
  // (TOOL_SELECTION лог: {"count":7,"tools":["find_client_by_name",
  // "get_client_info","create_session","search_client_history",
  // "update_client","create_client","get_schedule"]}), модель вместо
  // этого вызвала create_session — создала лишнюю сессию вместо отправки
  // ссылки на существующую. Согласованный заранее критерий отката:
  // любой случай, где routing не даёт модели нужный инструмент —
  // механизм отключается целиком, не патчится точечно (тот же принцип,
  // что и для отменённого domain routing выше). См. lib/agent/
  // toolSelection.ts — файл оставлен в репозитории для истории, не
  // используется.
  //
  // Рассмотренная и ОТКЛОНЁННАЯ альтернатива (21.09): ПОСТОЯННОЕ (не
  // зависящее от вопроса) удаление из списка 18 write-инструментов, у
  // которых есть UI-альтернатива — идея была не рисковать ошибочной
  // классификацией на лету, как в трёх провалившихся попытках выше.
  // Проверили по коду все 5 write-инструментов:
  //  - create_client, update_client, create_session — ДЕЙСТВИТЕЛЬНО
  //    имеют удобные UI-альтернативы (кнопка + простая форма, см.
  //    src/app/(app)/clients/page.tsx, src/app/(app)/clients/[id]/
  //    page.tsx, src/components/layout/Sidebar.tsx).
  //  - cancel_session, send_session_invite — UI-альтернативы НЕТ вообще
  //    (ни кнопки отмены сессии, ни кнопки "отправить ссылку на эту
  //    сессию" нигде в коде) — их удалять нельзя, это единственный
  //    способ выполнить эти действия.
  // Решение НЕ удалять даже 3 безопасных кандидата: расчёт по размеру
  // схемы (create_client+update_client+create_session ≈ 21% от 8442
  // символов схемы 18 инструментов) даёт оценочную экономию ~450-600
  // токенов за итерацию — 10-25% от цены запроса (1.25-1.66₽ при
  // типичных 2-3 итерациях), не кратное снижение. При этом create_session
  // реально используется в multi-step сценариях психолога ("когда есть
  // окно" → сразу запись) и явно закреплён в системном промпте (см. ниже
  // инструкцию про цепочку find_available_slots → create_session без
  // переспроса) — потеря разговорного пути ради умеренной экономии
  // признана невыгодным компромиссом. Ветка "сузить список инструментов"
  // (любым способом — динамическим или постоянным) считается ИСЧЕРПАННОЙ
  // после четырёх независимых рассмотрений (topK, keyword routing,
  // embedding retrieval, постоянное удаление по UI-альтернативе). Список
  // остаётся 18 инструментов.
  let availableTools: YandexGptTool[];
  if (isReferenceOnly) {
    availableTools = getReferenceOnlyTools();
  } else {
    availableTools = AGENT_TOOLS;
  }

  // Идентификатор ВСЕГО запроса психолога (не одной LLM-итерации) — см.
  // lib/agent/usageLog.ts. Общий и для кэш-хита, и для полного
  // агентского цикла, чтобы llm_usage_log можно было анализировать по
  // request_id независимо от того, каким путём был обработан вопрос.
  const requestId = randomUUID();

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
      // Кэш-хит — 0 LLM-вызовов, cost_rub=0 по построению (не через
      // estimateCostRub, там нет model для этого случая).
      waitUntil(
        logLlmUsage(supabase, {
          requestId,
          psychologistId: user.id,
          route: "reference",
          model: "cache_hit",
          usage: null,
          llmCallsCount: 0,
          toolCallsCount: 0,
          retriesCount: 0,
          cacheStatus: "hit",
          workflowSuccess: true,
        })
      );
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

  // Накопление данных для llm_usage_log (задача "рычаг 4", 20.09) —
  // суммируется по ВСЕМ LLM-итерациям этого запроса, пишется одной
  // строкой после выхода из цикла (см. logLlmUsage ниже).
  let llmCallsCount = 0;
  let toolCallsCount = 0;
  let lastModel = selectedModel === "lite" ? "yandexgpt-lite/latest" : "yandexgpt/latest";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokensSum = 0;

  // Защита от зацикливания (см. задачу "рычаг 3", 20.09): если модель
  // запрашивает ТОТ ЖЕ инструмент с ТЕМИ ЖЕ аргументами повторно, это
  // явный признак, что повтор не даст нового результата (например,
  // find_available_slots с одинаковыми датами дважды) — вместо того
  // чтобы тратить ещё один платный цикл tool-вызов + LLM-вызов на
  // заведомо тот же ответ, останавливаемся сразу с честным сообщением.
  // Ключ — имя инструмента + стабильно сериализованные аргументы.
  const calledToolSignatures = new Set<string>();
  function toolCallSignature(name: string, args: Record<string, unknown>): string {
    const sortedKeys = Object.keys(args).sort();
    const sortedArgs: Record<string, unknown> = {};
    for (const key of sortedKeys) sortedArgs[key] = args[key];
    return `${name}:${JSON.stringify(sortedArgs)}`;
  }
  // Считаем, сколько раз обнаружен повтор за весь запрос — один повтор
  // может быть безобидным (модель сама поймёт из сообщения об ошибке и
  // подберёт другие аргументы или ответит текстом), но если это
  // происходит снова, дальнейшие попытки почти наверняка тоже не
  // сдвинутся с места — обрываем сразу, не дожидаясь MAX_AGENT_ITERATIONS.
  let repeatedLoopCount = 0;

  // Веб-поиск при пустой базе знаний (21.09) — если ХОТЯ БЫ ОДИН вызов
  // search_knowledge_base в этом запросе вернул suggestWebSearch:true
  // (см. lib/agent/executor.ts), запоминаем исходный поисковый запрос,
  // чтобы прокинуть его в финальный JSON-ответ психологу. Фронтенд
  // (AssistantChat.tsx) увидит его и покажет кнопку "Да, поискать в
  // интернете" — САМ веб-поиск идёт отдельным узким эндпоинтом
  // (/api/assistant/web-search), не через этот agent loop.
  let suggestedWebSearchQuery: string | null = null;

  // Возвращает NextResponse, если цикл должен немедленно остановиться
  // (нужно подтверждение психолога); { shortCircuitText } если результат
  // инструмента уже самодостаточен как финальный ответ психологу (см.
  // ниже про get_period_summary); иначе null и продолжает messages для
  // следующей итерации. Вынесено в функцию, чтобы не дублировать одну и
  // ту же обработку toolCalls в двух местах цикла (см. ниже, где lite
  // неожиданно тоже запрашивает tool call).
  async function handleToolCalls(
    rawToolCalls: NonNullable<Awaited<ReturnType<typeof yandexGptCompleteWithTools>>["toolCalls"]>
  ): Promise<NextResponse | { shortCircuitText: string } | null> {
    // Жёсткий потолок на число вызовов в ОДНОЙ пачке (одна LLM-итерация
    // может в принципе запросить сразу несколько function calls) —
    // отдельная защита от MAX_AGENT_ITERATIONS, которая ограничивает
    // число итераций, но не число вызовов внутри одной. На практике
    // модель почти всегда запрашивает по одному вызову за итерацию (см.
    // логи YGPT_USAGE), это просто верхняя граница на аномальный случай.
    const MAX_TOOL_CALLS_PER_BATCH = 3;
    const toolCalls = rawToolCalls.slice(0, MAX_TOOL_CALLS_PER_BATCH);
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
      waitUntil(
        logLlmUsage(supabase, {
          requestId,
          psychologistId: userId,
          route: "agentic",
          model: lastModel,
          usage: {
            inputTextTokens: totalInputTokens,
            completionTokens: totalOutputTokens,
            totalTokens: totalTokensSum,
          },
          llmCallsCount,
          toolCallsCount,
          retriesCount: repeatedLoopCount,
          cacheStatus: "not_applicable",
          // confirmation_required — психолог получил осмысленную
          // реакцию (карточку подтверждения), это успешный workflow, а
          // не сбой, даже несмотря на то, что финальное действие ещё
          // не выполнено.
          workflowSuccess: true,
        })
      );
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
    let loopDetected = false;
    for (const call of toolCalls) {
      const signature = toolCallSignature(call.functionCall.name, call.functionCall.arguments);
      if (calledToolSignatures.has(signature)) {
        // Тот же вызов уже выполнялся в этом запросе — не выполняем его
        // снова (и не тратим на это ни backend, ни следующий LLM-вызов).
        // Сообщаем модели явно, что это повтор, а не молчим — так она с
        // высокой вероятностью остановится сама и даст текстовый ответ
        // на следующей (последней разрешённой) итерации, вместо того
        // чтобы получить обычный успешный результат и попробовать снова.
        toolResults.push({
          functionResult: {
            name: call.functionCall.name,
            content: JSON.stringify({
              error: "Этот вызов с такими же параметрами уже был выполнен в этом запросе — повторный вызов не даст нового результата. Ответь психологу тем, что уже известно, или уточни у него детали, если данных недостаточно.",
            }),
          },
        });
        loopDetected = true;
        continue;
      }
      calledToolSignatures.add(signature);
      toolCallsCount += 1;

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

        // Веб-поиск при пустой базе знаний (21.09, см. комментарий у
        // объявления suggestedWebSearchQuery выше) — запоминаем запрос,
        // не прерывая цикл: модель всё равно должна ответить психологу
        // текстом с явным предложением, это не short-circuit.
        if (
          call.functionCall.name === "search_knowledge_base" &&
          output &&
          typeof output === "object" &&
          (output as { suggestWebSearch?: boolean }).suggestWebSearch === true &&
          typeof (output as { query?: unknown }).query === "string"
        ) {
          suggestedWebSearchQuery = (output as { query: string }).query;
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

    if (loopDetected) {
      repeatedLoopCount += 1;
      if (repeatedLoopCount >= 2) {
        // Второе обнаруженное зацикливание за один запрос — дальнейшие
        // попытки почти наверняка тоже не сдвинутся с места. Обрываем
        // сразу честным сообщением, не дожидаясь исчерпания
        // MAX_AGENT_ITERATIONS (это сэкономит оставшиеся, заведомо
        // бесполезные, платные итерации).
        return {
          shortCircuitText:
            "Не удалось обработать этот запрос — потребовалось несколько попыток с одинаковым результатом. Попробуйте переформулировать вопрос или уточнить детали.",
        };
      }
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

      llmCallsCount += 1;
      lastModel = result.model;
      if (result.usage) {
        totalInputTokens += result.usage.inputTextTokens;
        totalOutputTokens += result.usage.completionTokens;
        totalTokensSum += result.usage.totalTokens;
      }

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
        const candidateText = unwrapped ?? result.text;

        // Третий баг того же семейства нестабильности, найденный 21.09
        // при regression-тесте structure-aware tool: модель на ПЕРВОЙ
        // итерации иногда отвечает намерением действовать вместо
        // реального действия — "Сейчас проверю...", "Сначала найду...",
        // без единого tool call (llm_calls_count=1, tool_calls_count=0
        // в llm_usage_log). Раньше это уходило психологу как финальный
        // ответ: он платит за запрос и получает пустышку вместо
        // содержательного ответа, хуже, чем честный отказ — выглядит
        // как зависший или сломанный продукт. Живой тест на Кате:
        // 4 повтора одного и того же класса вопросов дали сбой такого
        // вида 4 раза из 12 (~33%), но при немедленном повторе того же
        // запроса модель каждый раз реально выполняла tool call и
        // давала содержательный ответ — то есть один retry надёжно
        // закрывает проблему, без необходимости разбираться в причине
        // самой нестабильности модели.
        // Эвристика узнаёт паттерн "намерение без результата": короткий
        // текст (мало слов — реальный ответ психологу почти всегда
        // длиннее) + характерный глагол в будущем/настоящем времени,
        // который модель использует, объявляя о действии, а не
        // рассказывая факт. Применяется ТОЛЬКО на первой итерации без
        // единого tool call за весь запрос — легитимные короткие ответы
        // ("Нет, панических атак не было") не содержат этих глаголов и
        // не задевают эвристику.
        const looksLikeUnfulfilledIntent =
          iterations === 1 &&
          toolCallsCount === 0 &&
          candidateText.trim().split(/\s+/).length <= 15 &&
          /(сейчас проверю|сначала найду|сейчас найду|сначала проверю|сейчас посмотрю|сначала посмотрю|дай(?:те)? проверю|сейчас уточню|сначала уточню|сейчас посчитаю|сначала посчитаю|сейчас узнаю|сначала узнаю|сейчас гляну|сейчас загляну|сейчас подсчитаю|сейчас прикину)/i.test(
            candidateText
          );

        // Четвёртый баг того же семейства, найденный 21.09 при сквозной
        // проверке веб-поиска: системный промпт учит модель при
        // suggestWebSearch:true отвечать ФИКСИРОВАННОЙ фразой "...Хотите,
        // чтобы я поискал информацию в интернете?" (см. tools.ts) — но
        // модель иногда пишет эту же фразу текстом, ВООБЩЕ не вызвав
        // search_knowledge_base (ни настоящим tool call, ни псевдо-
        // вызовом), то есть suggestWebSearch физически не мог быть true.
        // Живой пример: вопрос про "протокол EMDR для ДРИ" — модель сразу
        // ответила "в базе знаний не нашлось... хотите чтобы я поискал в
        // интернете?" без единого вызова инструмента (llm_calls_count=1,
        // tool_calls_count=0, нет PSEUDO_TOOL_CALL_INTERCEPTED в логе).
        // Итог для психолога: кнопка веб-поиска не появляется, хотя текст
        // её обещал — выглядит как баг интерфейса, хотя на деле модель
        // просто не выполнила предпосылку для этой фразы. В отличие от
        // паттерна выше (короткое "намерение в будущем"), здесь текст
        // оформлен как ЗАВЕРШЁННЫЙ факт ("не нашлось") и длиннее 15 слов,
        // поэтому не ограничиваем по длине и не по номеру итерации —
        // проверяем ТОЛЬКО что во всём запросе не было ни одного вызова
        // инструмента (иначе легитимный случай, когда suggestWebSearch
        // реально true, и эта же фраза — корректный ответ, не должен
        // задевать эвристику).
        const looksLikeFakeWebSearchOffer =
          toolCallsCount === 0 &&
          /(хотите,?\s*чтобы\s*я\s*поиска[лн]|поискать\s*(?:информацию\s*)?в\s*интернете|поищу\s*(?:информацию\s*)?в\s*интернете)/i.test(
            candidateText
          );

        if (looksLikeUnfulfilledIntent || looksLikeFakeWebSearchOffer) {
          console.log(
            looksLikeFakeWebSearchOffer ? "FAKE_WEB_SEARCH_OFFER_RETRY" : "UNFULFILLED_INTENT_RETRY",
            JSON.stringify({ model: selectedModel, textPreview: candidateText.slice(0, 80) })
          );
          repeatedLoopCount += 1;
          // Потолок на ЭТОТ конкретный паттерн (найдено 24.09 при разборе
          // llm_usage_log за реальные деньги): раньше здесь не было верхней
          // границы вообще — эвристика просто ретраила с ТЕМИ ЖЕ messages
          // (ничего не меняя в контексте) до MAX_AGENT_ITERATIONS. При
          // temperature=0.2 модель на некоторых вопросах стабильно
          // воспроизводит один и тот же "намерение без действия" на КАЖДОЙ
          // попытке — в логах нашлись два реальных запроса, где это
          // произошло 5 раз подряд (retries_count=5, tool_calls_count=0),
          // исчерпав весь лимит итераций и стоив ~19₽ каждый БЕЗ единого
          // полезного ответа психологу (только "не удалось завершить
          // обработку..." в конце). Комментарий у looksLikeUnfulfilledIntent
          // утверждал "один retry надёжно закрывает проблему" — это не
          // подтвердилось на практике для всех случаев. Останавливаемся
          // после второй подряд попытки этого паттерна тем же честным
          // сообщением, что и при обнаружении зацикливания на повторном
          // tool call (см. loopDetected выше) — не тратим оставшиеся,
          // почти наверняка бесполезные, платные итерации.
          if (repeatedLoopCount >= 2) {
            finalText =
              "Не удалось получить содержательный ответ с первой попытки. Попробуйте переформулировать вопрос или задать его чуть подробнее.";
            break;
          }
          continue;
        }

        finalText = candidateText;
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
    waitUntil(
      logLlmUsage(supabase, {
        requestId,
        psychologistId: user.id,
        route: isReferenceOnly ? "reference" : "agentic",
        model: lastModel,
        usage: {
          inputTextTokens: totalInputTokens,
          completionTokens: totalOutputTokens,
          totalTokens: totalTokensSum,
        },
        llmCallsCount,
        toolCallsCount,
        retriesCount: repeatedLoopCount,
        cacheStatus: isReferenceOnly ? "miss" : "not_applicable",
        workflowSuccess: false,
      })
    );
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

  // Полная телеметрия стоимости (задача "рычаг 4", 20.09) — см.
  // lib/agent/usageLog.ts. workflowSuccess=false только при исчерпании
  // итераций (психолог не получил полезного результата, хотя ответ и
  // не был технической ошибкой 502) — confirmation_required считается
  // success раньше, в handleToolCalls, отдельной записи не делает
  // (тот путь возвращает NextResponse до этой точки).
  waitUntil(
    logLlmUsage(supabase, {
      requestId,
      psychologistId: user.id,
      route: isReferenceOnly ? "reference" : "agentic",
      model: lastModel,
      usage: {
        inputTextTokens: totalInputTokens,
        completionTokens: totalOutputTokens,
        totalTokens: totalTokensSum,
      },
      llmCallsCount,
      toolCallsCount,
      retriesCount: repeatedLoopCount,
      cacheStatus: isReferenceOnly ? "miss" : "not_applicable",
      workflowSuccess: !iterationsExhausted,
    })
  );

  return NextResponse.json({
    message: responseText,
    actions_taken: usedTools,
    agent_session_id: agentSessionId,
    message_id: assistantMessageId,
    // Веб-поиск при пустой базе знаний (21.09) — если задано, фронтенд
    // показывает кнопку "Да, поискать в интернете" под этим ответом.
    // Сам веб-поиск идёт отдельным узким путём (POST /api/assistant/
    // web-search), не через этот agent loop и не через схему 18
    // инструментов — см. комментарий у объявления переменной выше.
    suggested_web_search_query: suggestedWebSearchQuery,
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
