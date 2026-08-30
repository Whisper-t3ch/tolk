// ============================================================
// Реализация 14 инструментов AI-агента. Серверный код — вызывается
// только из /api/assistant и /api/assistant/confirm с уже
// авторизованным Supabase-клиентом (RLS ограничивает данные
// текущим психологом через auth.uid()).
//
// Инструменты из tools.ts.CONFIRMATION_REQUIRED_TOOLS сюда
// попадают только после подтверждения психолога — сам executor
// не знает о статусе подтверждения, это ответственность route.ts.
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { yandexGptEmbed } from "@/lib/yandexgpt";
import { buildAnonymizedPeriodSummary, PeriodSummaryError } from "@/lib/prompts/periodSummary";
import { anonymizeTranscript } from "@/lib/anonymize";
import { sendViaMessenger, MessengerSendError } from "@/lib/messengers/client";
import type { AgentToolName } from "./tools";

export class AgentToolError extends Error {
  constructor(message: string, public toolName: string) {
    super(message);
    this.name = "AgentToolError";
  }
}

interface ExecutorContext {
  supabase: SupabaseClient;
  psychologistId: string;
}

// ------------------------------------------------------------
// КЛИЕНТЫ
// ------------------------------------------------------------

async function getClients(ctx: ExecutorContext) {
  const { data, error } = await ctx.supabase
    .from("clients")
    .select("id, name, status, request, approach")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new AgentToolError(error.message, "get_clients");
  return { clients: data ?? [] };
}

async function getClientInfo(ctx: ExecutorContext, args: { client_id: string }) {
  const { data: client, error: clientError } = await ctx.supabase
    .from("clients")
    .select("id, name, status, request, approach, age, gender, joined_date, needs_attention")
    .eq("id", args.client_id)
    .maybeSingle();
  if (clientError) throw new AgentToolError(clientError.message, "get_client_info");
  if (!client) throw new AgentToolError("Клиент не найден", "get_client_info");

  const { data: sessions, error: sessionsError } = await ctx.supabase
    .from("sessions")
    .select("id, scheduled_at, status, duration_minutes")
    .eq("client_id", args.client_id)
    .order("scheduled_at", { ascending: false })
    .limit(10);
  if (sessionsError) throw new AgentToolError(sessionsError.message, "get_client_info");

  return { client, recent_sessions: sessions ?? [] };
}

async function createClient(
  ctx: ExecutorContext,
  args: { name: string; request?: string; approach?: string; telegram?: string; phone?: string }
) {
  const { data, error } = await ctx.supabase
    .from("clients")
    .insert({
      psychologist_id: ctx.psychologistId,
      name: args.name,
      request: args.request ?? null,
      approach: args.approach ?? null,
      status: "active",
    })
    .select("id, name, status, request, approach")
    .single();
  if (error) throw new AgentToolError(error.message, "create_client");
  // telegram/phone пока негде хранить в схеме clients — учтено в описании ответа психологу.
  return { client: data, note: args.telegram || args.phone ? "Telegram/телефон приняты, но пока не сохраняются — в схеме клиента нет таких полей." : undefined };
}

async function updateClient(ctx: ExecutorContext, args: { client_id: string; fields: Record<string, unknown> }) {
  const allowed = new Set(["name", "request", "approach", "status", "age", "gender", "needs_attention"]);
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args.fields ?? {})) {
    if (allowed.has(key)) patch[key] = value;
  }
  if (Object.keys(patch).length === 0) {
    throw new AgentToolError("Нет допустимых полей для обновления", "update_client");
  }
  const { data, error } = await ctx.supabase
    .from("clients")
    .update(patch)
    .eq("id", args.client_id)
    .select("id, name, status, request, approach")
    .single();
  if (error) throw new AgentToolError(error.message, "update_client");
  return { client: data };
}

// ------------------------------------------------------------
// ИСТОРИЯ И RAG
// ------------------------------------------------------------

async function searchClientHistory(ctx: ExecutorContext, args: { client_id: string; query: string }) {
  const queryEmbedding = await yandexGptEmbed(args.query, "query");

  const { data, error } = await ctx.supabase.rpc("match_session_transcripts", {
    query_embedding: queryEmbedding,
    match_client_id: args.client_id,
    match_psychologist_id: ctx.psychologistId,
    match_count: 5,
  });

  if (error) {
    // Функция match_session_transcripts создаётся отдельным SQL (см. ниже) —
    // если её ещё нет в базе, сообщаем понятно вместо непонятной ошибки Postgres.
    throw new AgentToolError(
      `Similarity search недоступен: ${error.message}. Убедитесь, что применена функция match_session_transcripts (migration_004_agent.sql + supporting function).`,
      "search_client_history"
    );
  }

  // Результаты попадают обратно в контекст модели как результат tool
  // call — анонимизируем raw_text каждого найденного фрагмента перед
  // возвратом (имя клиента сохраняется).
  const rows = (data ?? []) as Array<{ session_id: string; raw_text: string; similarity: number; scheduled_at: string }>;
  if (rows.length === 0) {
    return { results: [] };
  }

  const { data: client } = await ctx.supabase.from("clients").select("name").eq("id", args.client_id).maybeSingle();
  const clientName = client?.name ?? "";

  const anonymizedRows = await Promise.all(
    rows.map(async row => ({
      ...row,
      raw_text: await anonymizeTranscript(row.raw_text, clientName),
    }))
  );

  return { results: anonymizedRows };
}

// Использует общую buildAnonymizedPeriodSummary (см. lib/prompts/periodSummary.ts)
// — раньше здесь была независимая копия логики /api/clients/[id]/summary,
// которая разошлась по поведению. Лимит здесь НЕ списывается отдельно:
// /api/assistant уже списывает "agentTask" (3) за всю цепочку вызовов
// инструментов после её завершения, независимо от того, какие именно
// инструменты вызывались — повторное списание здесь удвоило бы
// стоимость для психолога. Результат всё же сохраняется в
// period_summaries, чтобы срез был виден в истории вне зависимости от
// того, вызван он через кнопку в UI или через ассистента.
async function getPeriodSummary(ctx: ExecutorContext, args: { client_id: string; date_from: string; date_to: string }) {
  const { data: sessions, error: sessionsError } = await ctx.supabase
    .from("sessions")
    .select("id, scheduled_at")
    .eq("client_id", args.client_id)
    .eq("psychologist_id", ctx.psychologistId)
    .gte("scheduled_at", args.date_from)
    .lte("scheduled_at", args.date_to)
    .order("scheduled_at", { ascending: true });
  if (sessionsError) throw new AgentToolError(sessionsError.message, "get_period_summary");
  if (!sessions || sessions.length === 0) {
    throw new AgentToolError("В указанном периоде нет сессий с этим клиентом", "get_period_summary");
  }

  const { data: client } = await ctx.supabase
    .from("clients")
    .select("name")
    .eq("id", args.client_id)
    .eq("psychologist_id", ctx.psychologistId)
    .maybeSingle();
  const clientName = client?.name ?? "";

  let periodSummary;
  try {
    periodSummary = await buildAnonymizedPeriodSummary(
      ctx.supabase,
      sessions.map(s => ({ id: s.id as string, scheduled_at: s.scheduled_at as string })),
      clientName
    );
  } catch (e) {
    const message = e instanceof PeriodSummaryError ? e.message : "Не удалось сгенерировать срез";
    throw new AgentToolError(message, "get_period_summary");
  }

  const { summaryText, structured, sectionsCount, dateStart, dateEnd } = periodSummary;

  await ctx.supabase.from("period_summaries").insert({
    psychologist_id: ctx.psychologistId,
    client_id: args.client_id,
    period_start: dateStart,
    period_end: dateEnd,
    sessions_count: sectionsCount,
    summary: summaryText,
  });

  return { summary: summaryText, structured };
}

async function searchKnowledgeBase(ctx: ExecutorContext, args: { query: string; approach?: string }) {
  const queryEmbedding = await yandexGptEmbed(args.query, "query");

  const { data, error } = await ctx.supabase.rpc("match_knowledge_base", {
    query_embedding: queryEmbedding,
    match_psychologist_id: ctx.psychologistId,
    match_approach: args.approach ?? null,
    match_count: 3,
  });

  if (error) {
    throw new AgentToolError(
      `Similarity search недоступен: ${error.message}. Убедитесь, что применена функция match_knowledge_base.`,
      "search_knowledge_base"
    );
  }
  return { results: data ?? [] };
}

// ------------------------------------------------------------
// РАСПИСАНИЕ
// ------------------------------------------------------------

async function getSchedule(ctx: ExecutorContext, args: { date_from: string; date_to: string }) {
  const { data, error } = await ctx.supabase
    .from("sessions")
    .select("id, client_id, scheduled_at, duration_minutes, status, clients ( name )")
    .gte("scheduled_at", args.date_from)
    .lte("scheduled_at", args.date_to)
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: true });
  if (error) throw new AgentToolError(error.message, "get_schedule");
  return { sessions: data ?? [] };
}

async function getPreferences(ctx: ExecutorContext) {
  const { data, error } = await ctx.supabase
    .from("psychologist_preferences")
    .select("key, value")
    .eq("psychologist_id", ctx.psychologistId);
  if (error) throw new AgentToolError(error.message, "get_preferences");
  const preferences: Record<string, unknown> = {};
  for (const row of data ?? []) {
    preferences[row.key as string] = row.value;
  }
  return { preferences };
}

interface Slot {
  date: string;
  time: string;
  datetime: string;
}

async function findAvailableSlots(
  ctx: ExecutorContext,
  args: { duration_minutes: number; date_from?: string; date_to?: string }
) {
  const dateFrom = args.date_from ?? new Date().toISOString().slice(0, 10);
  const defaultTo = new Date();
  defaultTo.setDate(defaultTo.getDate() + 14);
  const dateTo = args.date_to ?? defaultTo.toISOString().slice(0, 10);

  const { preferences } = await getPreferences(ctx);
  const restMinutes = ((preferences.rest_between_sessions as { minutes?: number } | undefined)?.minutes) ?? 0;
  const preferredHours = preferences.preferred_hours as { start?: string; end?: string } | undefined;
  const startHour = preferredHours?.start ?? "09:00";
  const endHour = preferredHours?.end ?? "21:00";
  const preferredDays = (preferences.preferred_days as string[] | undefined) ?? [
    "mon", "tue", "wed", "thu", "fri",
  ];
  const dayCodeMap: Record<number, string> = { 0: "sun", 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat" };

  const { data: busySessions, error } = await ctx.supabase
    .from("sessions")
    .select("scheduled_at, duration_minutes")
    .gte("scheduled_at", `${dateFrom}T00:00:00`)
    .lte("scheduled_at", `${dateTo}T23:59:59`)
    .neq("status", "cancelled");
  if (error) throw new AgentToolError(error.message, "find_available_slots");

  const busyIntervals = (busySessions ?? []).map(s => {
    const start = new Date(s.scheduled_at as string).getTime();
    const durationMin = (s.duration_minutes as number | null) ?? 50;
    const end = start + durationMin * 60_000;
    return { start: start - restMinutes * 60_000, end: end + restMinutes * 60_000 };
  });

  const slots: Slot[] = [];
  const [startH, startM] = startHour.split(":").map(Number);
  const [endH, endM] = endHour.split(":").map(Number);
  const stepMinutes = 30;

  const cursor = new Date(`${dateFrom}T00:00:00`);
  const limitDate = new Date(`${dateTo}T23:59:59`);

  while (cursor <= limitDate && slots.length < 20) {
    const dayCode = dayCodeMap[cursor.getDay()];
    if (preferredDays.includes(dayCode)) {
      const dayStart = new Date(cursor);
      dayStart.setHours(startH, startM, 0, 0);
      const dayEnd = new Date(cursor);
      dayEnd.setHours(endH, endM, 0, 0);

      for (let t = new Date(dayStart); t.getTime() + args.duration_minutes * 60_000 <= dayEnd.getTime(); t.setMinutes(t.getMinutes() + stepMinutes)) {
        const slotStart = t.getTime();
        const slotEnd = slotStart + args.duration_minutes * 60_000;
        const overlaps = busyIntervals.some(b => slotStart < b.end && slotEnd > b.start);
        const inPast = slotStart < Date.now();
        if (!overlaps && !inPast) {
          const d = new Date(slotStart);
          slots.push({
            date: d.toISOString().slice(0, 10),
            time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
            datetime: d.toISOString(),
          });
          if (slots.length >= 20) break;
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }

  return { slots };
}

// ------------------------------------------------------------
// СЕССИИ
// ------------------------------------------------------------

async function createSession(ctx: ExecutorContext, args: { client_id: string; datetime: string; duration_minutes?: number }) {
  const { data, error } = await ctx.supabase
    .from("sessions")
    .insert({
      psychologist_id: ctx.psychologistId,
      client_id: args.client_id,
      scheduled_at: args.datetime,
      duration_minutes: args.duration_minutes ?? 50,
      status: "scheduled",
    })
    .select("id, client_id, scheduled_at, duration_minutes, status")
    .single();
  if (error) throw new AgentToolError(error.message, "create_session");
  // Автосоздание Jitsi-комнаты — часть Трека Б (VPS с Jitsi+GigaAM),
  // который на момент разработки этой фичи ещё не развёрнут. Сессия
  // создаётся без video_room_url; поле добавится когда Трек Б будет готов.
  return {
    session: data,
    note: "Сессия создана. Автосоздание видеокомнаты Jitsi будет подключено вместе с Треком Б (сервер ещё не развёрнут).",
  };
}

async function cancelSession(ctx: ExecutorContext, args: { session_id: string; reason?: string }) {
  const patch: Record<string, unknown> = { status: "cancelled" };
  if (args.reason) patch.notes = `Отменена: ${args.reason}`;
  const { data, error } = await ctx.supabase
    .from("sessions")
    .update(patch)
    .eq("id", args.session_id)
    .select("id, status")
    .single();
  if (error) throw new AgentToolError(error.message, "cancel_session");
  return { session: data };
}

// ------------------------------------------------------------
// КОММУНИКАЦИЯ — реальная отправка через Telegram/VK, если у
// клиента есть привязанный чат (client_messenger_links) и
// интеграция психолога подключена (messenger_integrations,
// см. migration_005_integrations.sql). Если привязки/интеграции
// нет — сообщение всё равно сохраняется в messages со
// status='pending', чтобы психолог видел его в едином чате и мог
// разобраться (например, отправить клиенту ссылку-приглашение на
// подключение мессенджера).
// ------------------------------------------------------------

type MessengerPlatform = "telegram" | "vk";

async function tryDeliverMessage(
  ctx: ExecutorContext,
  clientId: string,
  channel: "telegram" | "vk" | "max",
  text: string
): Promise<{ status: "sent" | "pending"; externalMessageId?: string; errorMessage?: string }> {
  if (channel !== "telegram" && channel !== "vk") {
    // 'max' оставлен только для старых записей — новых отправок через него не бывает.
    return { status: "pending" };
  }
  const platform = channel as MessengerPlatform;

  const { data: link } = await ctx.supabase
    .from("client_messenger_links")
    .select("external_chat_id")
    .eq("client_id", clientId)
    .eq("psychologist_id", ctx.psychologistId)
    .eq("platform", platform)
    .maybeSingle();
  if (!link) return { status: "pending" };

  const { data: integration } = await ctx.supabase
    .from("messenger_integrations")
    .select("bot_token, vk_group_id, status")
    .eq("psychologist_id", ctx.psychologistId)
    .eq("platform", platform)
    .maybeSingle();
  if (!integration || integration.status !== "connected" || !integration.bot_token) {
    return { status: "pending" };
  }

  try {
    const result = await sendViaMessenger(
      platform,
      { botToken: integration.bot_token, vkGroupId: integration.vk_group_id },
      link.external_chat_id as string,
      text
    );
    return { status: "sent", externalMessageId: result.externalMessageId };
  } catch (err) {
    const message = err instanceof MessengerSendError ? err.message : "Не удалось отправить сообщение";
    return { status: "pending", errorMessage: message };
  }
}

async function sendMessageToClient(
  ctx: ExecutorContext,
  args: { client_id: string; text: string; channel: "telegram" | "vk" | "max" }
) {
  const delivery = await tryDeliverMessage(ctx, args.client_id, args.channel, args.text);

  const { data, error } = await ctx.supabase
    .from("messages")
    .insert({
      psychologist_id: ctx.psychologistId,
      client_id: args.client_id,
      channel: args.channel,
      kind: "message",
      text: args.text,
      status: delivery.status,
      external_message_id: delivery.externalMessageId ?? null,
      error_message: delivery.errorMessage ?? null,
      sent_at: delivery.status === "sent" ? new Date().toISOString() : null,
    })
    .select("id, channel, text, status, created_at")
    .single();
  if (error) throw new AgentToolError(error.message, "send_message_to_client");

  return {
    message: data,
    note:
      delivery.status === "sent"
        ? "Сообщение отправлено клиенту."
        : delivery.errorMessage
          ? `Не удалось отправить: ${delivery.errorMessage}. Сообщение сохранено, можно повторить позже.`
          : "У клиента нет привязанного чата в мессенджере (или канал не подключён) — сообщение сохранено, отправка станет доступна после привязки.",
  };
}

async function sendHomework(ctx: ExecutorContext, args: { client_id: string; homework_text: string }) {
  const delivery = await tryDeliverMessage(ctx, args.client_id, "telegram", args.homework_text);

  const { data, error } = await ctx.supabase
    .from("messages")
    .insert({
      psychologist_id: ctx.psychologistId,
      client_id: args.client_id,
      channel: "telegram",
      kind: "homework",
      text: args.homework_text,
      status: delivery.status,
      external_message_id: delivery.externalMessageId ?? null,
      error_message: delivery.errorMessage ?? null,
      sent_at: delivery.status === "sent" ? new Date().toISOString() : null,
    })
    .select("id, channel, text, status, created_at")
    .single();
  if (error) throw new AgentToolError(error.message, "send_homework");

  return {
    message: data,
    note:
      delivery.status === "sent"
        ? "Домашнее задание отправлено клиенту в Telegram."
        : "Домашнее задание сохранено. У клиента нет привязанного Telegram (или бот не подключён) — отправка станет доступна после привязки.",
  };
}

async function sendSessionInvite(ctx: ExecutorContext, args: { session_id: string }) {
  const { data: session, error: sessionError } = await ctx.supabase
    .from("sessions")
    .select("id, client_id, scheduled_at")
    .eq("id", args.session_id)
    .maybeSingle();
  if (sessionError) throw new AgentToolError(sessionError.message, "send_session_invite");
  if (!session) throw new AgentToolError("Сессия не найдена", "send_session_invite");

  const text = "Ссылка на видеовстречу будет доступна после подключения видеосвязи (Трек Б).";
  const delivery = await tryDeliverMessage(ctx, session.client_id as string, "telegram", text);

  const { data, error } = await ctx.supabase
    .from("messages")
    .insert({
      psychologist_id: ctx.psychologistId,
      client_id: session.client_id,
      channel: "telegram",
      kind: "session_invite",
      text,
      status: delivery.status,
      external_message_id: delivery.externalMessageId ?? null,
      error_message: delivery.errorMessage ?? null,
      related_session_id: session.id,
      sent_at: delivery.status === "sent" ? new Date().toISOString() : null,
    })
    .select("id, channel, text, status, created_at")
    .single();
  if (error) throw new AgentToolError(error.message, "send_session_invite");

  return {
    message: data,
    note:
      delivery.status === "sent"
        ? "Приглашение отправлено клиенту в Telegram. Реальная ссылка на видеокомнату появится после подключения Jitsi (Трек Б) — сейчас отправлен текст-заглушка."
        : "Приглашение сохранено. У клиента нет привязанного Telegram (или бот не подключён) — отправка станет доступна после привязки. Ссылка на видеокомнату появится после подключения Jitsi (Трек Б).",
  };
}

// ------------------------------------------------------------
// Диспетчер
// ------------------------------------------------------------

export async function executeAgentTool(
  ctx: ExecutorContext,
  name: AgentToolName | string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name as AgentToolName) {
    case "get_clients":
      return getClients(ctx);
    case "get_client_info":
      return getClientInfo(ctx, args as { client_id: string });
    case "create_client":
      return createClient(ctx, args as { name: string; request?: string; approach?: string; telegram?: string; phone?: string });
    case "update_client":
      return updateClient(ctx, args as { client_id: string; fields: Record<string, unknown> });
    case "search_client_history":
      return searchClientHistory(ctx, args as { client_id: string; query: string });
    case "get_period_summary":
      return getPeriodSummary(ctx, args as { client_id: string; date_from: string; date_to: string });
    case "search_knowledge_base":
      return searchKnowledgeBase(ctx, args as { query: string; approach?: string });
    case "get_schedule":
      return getSchedule(ctx, args as { date_from: string; date_to: string });
    case "get_preferences":
      return getPreferences(ctx);
    case "find_available_slots":
      return findAvailableSlots(ctx, args as { duration_minutes: number; date_from?: string; date_to?: string });
    case "create_session":
      return createSession(ctx, args as { client_id: string; datetime: string; duration_minutes?: number });
    case "cancel_session":
      return cancelSession(ctx, args as { session_id: string; reason?: string });
    case "send_message_to_client":
      return sendMessageToClient(ctx, args as { client_id: string; text: string; channel: "telegram" | "vk" | "max" });
    case "send_homework":
      return sendHomework(ctx, args as { client_id: string; homework_text: string });
    case "send_session_invite":
      return sendSessionInvite(ctx, args as { session_id: string });
    default:
      throw new AgentToolError(`Неизвестный инструмент: ${name}`, String(name));
  }
}
