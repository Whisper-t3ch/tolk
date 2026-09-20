// ============================================================
// Реализация 17 инструментов AI-агента. Серверный код — вызывается
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
import { buildPeriodSummary, PeriodSummaryError } from "@/lib/prompts/periodSummary";
import { sendViaMessenger, MessengerSendError } from "@/lib/messengers/client";
import { buildJitsiRoomName, buildJitsiUrl, checkJitsiEnv } from "@/lib/jitsi";
import { zonedDateTimeToUtc, formatTimeInTimeZone, weekdayInTimeZone, todayInTimeZone, formatDateInTimeZone, DEFAULT_TIMEZONE } from "@/lib/timezone";
import { generateAvailableSlots, type WorkingHours } from "@/lib/booking";
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
  /**
   * IANA-идентификатор пояса психолога (psychologists.timezone). Опционален
   * ради обратной совместимости мест, которые ещё не обновлены — но
   * findAvailableSlots и createSession используют его напрямую, поэтому
   * оба вызывающих route.ts должны его передавать. Без этого поля функции
   * молча падают на DEFAULT_TIMEZONE, что даёт неверные слоты для любого
   * психолога вне Москвы — тот же класс бага, что чинился в
   * src/lib/data/sessions.ts.
   */
  timeZone?: string;
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

async function findClientByName(ctx: ExecutorContext, args: { name_query: string }) {
  const query = (args.name_query ?? "").trim();
  if (!query) throw new AgentToolError("Не указано имя для поиска", "find_client_by_name");

  const { data, error } = await ctx.supabase
    .from("clients")
    .select("id, name, status, request")
    .eq("psychologist_id", ctx.psychologistId)
    .is("deleted_at", null)
    .ilike("name", `%${query}%`)
    .order("name", { ascending: true })
    .limit(10);
  if (error) throw new AgentToolError(error.message, "find_client_by_name");

  const clients = data ?? [];
  if (clients.length === 0) {
    return { clients: [], note: `Клиент по запросу «${query}» не найден. Возможно, психолог назвал имя неточно — уточни у него.` };
  }
  return { clients };
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

  // match_session_transcript_chunks (не match_session_transcripts) —
  // см. migration_034_session_transcript_chunks.sql. Embedding на
  // уровне целой сессии больше не считается (YandexGPT Embeddings
  // ограничен 2048 токенами на вход, часовая сессия обычно крупнее),
  // поиск идёт по чанкам ~4000 символов каждый.
  const { data, error } = await ctx.supabase.rpc("match_session_transcript_chunks", {
    query_embedding: queryEmbedding,
    match_client_id: args.client_id,
    match_psychologist_id: ctx.psychologistId,
    // Берём больше чанков, чем нужно результатов — несколько лучших
    // чанков могут прийти из одной и той же сессии, схлопываем ниже.
    match_count: 15,
  });

  if (error) {
    throw new AgentToolError(
      `Similarity search недоступен: ${error.message}. Убедитесь, что применена функция match_session_transcript_chunks (migration_034_session_transcript_chunks.sql).`,
      "search_client_history"
    );
  }

  // chunk_text уже анонимизирован на этапе сохранения (анонимизация
  // применяется к целому raw_text до чанкинга, см.
  // lib/transcriptChunking.ts) — повторная анонимизация не нужна.
  const rows = (data ?? []) as Array<{ session_id: string; chunk_text: string; similarity: number; scheduled_at: string }>;

  // Схлопываем по session_id — модели полезнее 5 разных сессий, чем
  // 5 лучших чанков из одной и той же (если психолог долго обсуждал
  // тревогу на одной сессии, все топ-чанки могут быть оттуда). Берём
  // лучший чанк на сессию, сохраняя порядок по similarity.
  const bestPerSession = new Map<string, { session_id: string; raw_text: string; similarity: number; scheduled_at: string }>();
  for (const row of rows) {
    const existing = bestPerSession.get(row.session_id);
    if (!existing || row.similarity > existing.similarity) {
      bestPerSession.set(row.session_id, {
        session_id: row.session_id,
        raw_text: row.chunk_text,
        similarity: row.similarity,
        scheduled_at: row.scheduled_at,
      });
    }
  }
  const results = Array.from(bestPerSession.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);

  return { results };
}

// Использует общую buildPeriodSummary (см. lib/prompts/periodSummary.ts)
// — раньше здесь была независимая копия логики /api/clients/[id]/summary,
// которая разошлась по поведению. Лимит здесь НЕ списывается отдельно:
// /api/assistant уже списывает "agentTask" (3) за всю цепочку вызовов
// инструментов после её завершения, независимо от того, какие именно
// инструменты вызывались — повторное списание здесь удвоило бы
// стоимость для психолога. Результат всё же сохраняется в
// period_summaries, чтобы срез был виден в истории вне зависимости от
// того, вызван он через кнопку в UI или через ассистента.
// Результаты психодиагностических методик клиента. Раньше ассистент не
// имел доступа к test_results ни одним инструментом: психолог назначал
// тест, клиент проходил, балл считался — а на вопрос «какие результаты
// тестов у Анны Петровой» ассистент честно отвечал, что таких данных у
// него нет. Название методики берём из справочника test_questionnaires,
// потому что в test_type лежит ключ вроде PRIKHOZHAN.
async function getTestResults(ctx: ExecutorContext, args: { client_id: string }) {
  const { data, error } = await ctx.supabase
    .from("test_results")
    .select("test_type, score, max_score, interpretation, status, created_at, test_questionnaires ( title )")
    .eq("client_id", args.client_id)
    .eq("psychologist_id", ctx.psychologistId)
    .eq("status", "completed")
    .order("created_at", { ascending: true });

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { results: [], note: "У клиента пока нет завершённых тестов." };
  }

  return {
    results: data.map(row => {
      const rel = row.test_questionnaires as { title?: string } | { title?: string }[] | null;
      const questionnaire = Array.isArray(rel) ? rel[0] : rel;
      return {
        test: questionnaire?.title ?? row.test_type,
        score: row.score,
        max_score: row.max_score,
        interpretation: row.interpretation,
        date: (row.created_at as string).slice(0, 10),
      };
    }),
  };
}

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
    periodSummary = await buildPeriodSummary(
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

// БЫЛО: вся функция работала на серверном Date (Vercel, UTC) без единого
// обращения к часовому поясу психолога — preferred_hours "09:00"-"21:00"
// применялись к времени СЕРВЕРА через setHours(), а d.getHours() при
// формировании слота (строка ниже) читал результат тоже в поясе сервера.
// Психолог из Омска (UTC+3), настроивший «работаю с 9 до 21», получил бы
// от ассистента слоты, реально соответствующие 12:00-00:00 по его часам.
// Тот же класс бага, что чинился в src/lib/data/sessions.ts — только там
// про ЧТЕНИЕ существующих сессий, а здесь про ГЕНЕРАЦИЮ новых предложений.
//
// СТАЛО (после прогона-2): основной путь вообще не считает слоты сам, а
// берёт booking_settings психолога и отдаёт их в generateAvailableSlots
// из lib/booking.ts — ту же функцию, на которой работает публичная
// страница записи. Ручной цикл ниже остался только как запасной путь
// для психолога, который ещё не настраивал публичную запись.
async function findAvailableSlots(
  ctx: ExecutorContext,
  args: { duration_minutes: number; date_from?: string; date_to?: string }
) {
  const timeZone = ctx.timeZone ?? DEFAULT_TIMEZONE;
  const dateFrom = args.date_from ?? todayInTimeZone(timeZone);
  const defaultTo = new Date();
  defaultTo.setDate(defaultTo.getDate() + 14);
  const dateTo = args.date_to ?? formatDateInTimeZone(defaultTo, timeZone);

  // Рабочие часы берём из booking_settings — того же места, которое
  // психолог заполняет в «Настройки → Публичная запись» и по которому
  // клиенты бронируют время сами. Раньше здесь читались
  // psychologist_preferences.preferred_hours с дефолтом 09:00–21:00: у
  // психолога с расписанием 10:00–19:00 ассистент бодро предлагал 09:00
  // и 20:00, то есть звал клиента на время, когда психолог не работает.
  // Два независимых источника рабочих часов, причём про второй психолог
  // не знал и настроить его из интерфейса не мог.
  //
  // Слоты считает generateAvailableSlots из lib/booking.ts — та же
  // функция, что обслуживает публичную страницу записи. Так ассистент и
  // форма бронирования не могут разойтись в ответе на один и тот же
  // вопрос «когда психолог свободен».
  const { data: bookingSettings } = await ctx.supabase
    .from("booking_settings")
    .select("working_hours, session_duration_minutes, buffer_minutes, min_notice_hours")
    .eq("psychologist_id", ctx.psychologistId)
    .maybeSingle();

  if (bookingSettings?.working_hours) {
    const { data: busy, error: busyError } = await ctx.supabase
      .from("sessions")
      .select("scheduled_at, duration_minutes")
      .gte("scheduled_at", `${dateFrom}T00:00:00`)
      .lte("scheduled_at", `${dateTo}T23:59:59`)
      .neq("status", "cancelled");
    if (busyError) throw new AgentToolError(busyError.message, "find_available_slots");

    const defaultDuration = (bookingSettings.session_duration_minutes as number | null) ?? 50;
    const occupied = (busy ?? []).map(s => {
      const start = new Date(s.scheduled_at as string);
      const durationMin = (s.duration_minutes as number | null) ?? defaultDuration;
      return {
        start: start.toISOString(),
        end: new Date(start.getTime() + durationMin * 60_000).toISOString(),
      };
    });

    const generated = generateAvailableSlots({
      fromDate: dateFrom,
      toDate: dateTo,
      workingHours: bookingSettings.working_hours as WorkingHours,
      // Длительность, которую попросила модель, важнее настройки по
      // умолчанию: психолог мог попросить «найди час» при обычных 50
      // минутах.
      sessionDurationMinutes: args.duration_minutes || defaultDuration,
      bufferMinutes: (bookingSettings.buffer_minutes as number | null) ?? 0,
      minNoticeHours: (bookingSettings.min_notice_hours as number | null) ?? 0,
      occupied,
      timeZone,
    });

    const slots: Slot[] = generated.slice(0, 20).map(s => ({
      date: s.date,
      time: s.time,
      datetime: zonedDateTimeToUtc(s.date, s.time, timeZone).toISOString(),
    }));

    return { slots };
  }

  // Публичная запись ещё не настроена — работаем по старому пути, через
  // предпочтения ассистента. Это по-прежнему единственный источник для
  // психолога, который не открывал раздел «Публичная запись».
  const { preferences } = await getPreferences(ctx);
  const restMinutes = ((preferences.rest_between_sessions as { minutes?: number } | undefined)?.minutes) ?? 0;
  const preferredHours = preferences.preferred_hours as { start?: string; end?: string } | undefined;
  const startHour = preferredHours?.start ?? "09:00";
  const endHour = preferredHours?.end ?? "21:00";
  const preferredDays = (preferences.preferred_days as string[] | undefined) ?? [
    "mon", "tue", "wed", "thu", "fri",
  ];
  const dayCodeMap = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

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
  const stepMinutes = 30;

  // Перебираем календарные дни диапазона как строки YYYY-MM-DD (не Date
  // сервера) — день недели и рабочие часы вычисляем строго в поясе
  // психолога через weekdayInTimeZone/zonedDateTimeToUtc.
  let cursorDate = dateFrom;
  while (cursorDate <= dateTo && slots.length < 20) {
    const dayStartUtc = zonedDateTimeToUtc(cursorDate, "00:00", timeZone);
    const dayCode = dayCodeMap[weekdayInTimeZone(dayStartUtc, timeZone)];

    if (preferredDays.includes(dayCode)) {
      const dayOpenUtc = zonedDateTimeToUtc(cursorDate, startHour, timeZone);
      const dayCloseUtc = zonedDateTimeToUtc(cursorDate, endHour, timeZone);

      for (
        let slotStart = dayOpenUtc.getTime();
        slotStart + args.duration_minutes * 60_000 <= dayCloseUtc.getTime();
        slotStart += stepMinutes * 60_000
      ) {
        const slotEnd = slotStart + args.duration_minutes * 60_000;
        const overlaps = busyIntervals.some(b => slotStart < b.end && slotEnd > b.start);
        const inPast = slotStart < Date.now();
        if (!overlaps && !inPast) {
          const d = new Date(slotStart);
          slots.push({
            date: cursorDate,
            time: formatTimeInTimeZone(d, timeZone),
            datetime: d.toISOString(),
          });
          if (slots.length >= 20) break;
        }
      }
    }

    // Следующий календарный день (строкой, чтобы не зависеть от Date
    // сервера и от переходов летнего времени внутри цикла).
    const [y, m, dd] = cursorDate.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, dd + 1));
    cursorDate = next.toISOString().slice(0, 10);
  }

  return { slots };
}

// ------------------------------------------------------------
// СЕССИИ
// ------------------------------------------------------------

async function createSession(ctx: ExecutorContext, args: { client_id: string; datetime: string; duration_minutes?: number }) {
  // id генерируется заранее (crypto.randomUUID), чтобы имя Jitsi-комнаты
  // было известно до insert — так jitsi_room_name попадает в БД одним
  // запросом, без отдельного UPDATE после создания.
  const sessionId = crypto.randomUUID();
  const roomName = buildJitsiRoomName(sessionId);

  const { data, error } = await ctx.supabase
    .from("sessions")
    .insert({
      id: sessionId,
      psychologist_id: ctx.psychologistId,
      client_id: args.client_id,
      scheduled_at: args.datetime,
      duration_minutes: args.duration_minutes ?? 50,
      status: "scheduled",
      jitsi_room_name: roomName,
    })
    .select("id, client_id, scheduled_at, duration_minutes, status")
    .single();
  if (error) throw new AgentToolError(error.message, "create_session");

  const jitsiReady = checkJitsiEnv().configured;
  return {
    session: { ...data, video_room_url: buildJitsiUrl(roomName) || null },
    note: jitsiReady
      ? "Сессия создана, ссылка на видеокомнату готова."
      : "Сессия создана. Ссылка на видеокомнату станет рабочей после развёртывания видеосервера (ВМ ещё не подключена).",
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

// Массовая рассылка активным клиентам психолога. Необратимое действие —
// проходит через тот же механизм подтверждения, что и остальные
// массовые/необратимые инструменты (см. CONFIRMATION_REQUIRED_TOOLS в
// tools.ts). Канал берётся из client_messenger_links (реальная привязка
// мессенджера у клиента) — это тот же источник истины, которым
// пользуется tryDeliverMessage для точечной отправки; если привязки нет,
// используем "telegram" как канал по умолчанию для записи в messages
// (согласуется с sendHomework/sendSessionInvite), отправка всё равно
// останется в статусе pending, пока канал не подключат.
async function sendBroadcastMessage(ctx: ExecutorContext, args: { text: string }) {
  const text = (args.text ?? "").trim();
  if (!text) throw new AgentToolError("Не указан текст сообщения", "send_broadcast_message");

  const { data: clients, error: clientsError } = await ctx.supabase
    .from("clients")
    .select("id, name")
    .eq("psychologist_id", ctx.psychologistId)
    .eq("status", "active")
    .is("deleted_at", null);
  if (clientsError) throw new AgentToolError(clientsError.message, "send_broadcast_message");
  if (!clients || clients.length === 0) {
    return { sent_to: [], note: "Нет активных клиентов для рассылки." };
  }

  const clientIds = clients.map(c => c.id as string);
  const { data: links } = await ctx.supabase
    .from("client_messenger_links")
    .select("client_id, platform")
    .in("client_id", clientIds);
  const channelByClient = new Map<string, "telegram" | "vk">();
  for (const link of links ?? []) {
    channelByClient.set(link.client_id as string, link.platform as "telegram" | "vk");
  }

  const results: Array<{ client_id: string; client_name: string; channel: string; status: string }> = [];
  for (const client of clients) {
    const clientId = client.id as string;
    const channel = channelByClient.get(clientId) ?? "telegram";
    const delivery = await tryDeliverMessage(ctx, clientId, channel, text);

    const { data, error } = await ctx.supabase
      .from("messages")
      .insert({
        psychologist_id: ctx.psychologistId,
        client_id: clientId,
        channel,
        kind: "broadcast",
        text,
        status: delivery.status,
        external_message_id: delivery.externalMessageId ?? null,
        error_message: delivery.errorMessage ?? null,
        sent_at: delivery.status === "sent" ? new Date().toISOString() : null,
      })
      .select("status")
      .single();
    if (error) {
      results.push({ client_id: clientId, client_name: client.name as string, channel, status: "error" });
      continue;
    }
    results.push({ client_id: clientId, client_name: client.name as string, channel, status: data.status as string });
  }

  const sentCount = results.filter(r => r.status === "sent").length;
  const pendingCount = results.filter(r => r.status === "pending").length;

  return {
    sent_to: results,
    note: `Разослано ${results.length} клиентам: отправлено ${sentCount}, отложено (нет подключённого канала) ${pendingCount}.`,
  };
}

async function sendSessionInvite(ctx: ExecutorContext, args: { session_id: string }) {
  const { data: session, error: sessionError } = await ctx.supabase
    .from("sessions")
    .select("id, client_id, scheduled_at, jitsi_room_name")
    .eq("id", args.session_id)
    .eq("psychologist_id", ctx.psychologistId)
    .maybeSingle();
  if (sessionError) throw new AgentToolError(sessionError.message, "send_session_invite");
  if (!session) throw new AgentToolError("Сессия не найдена", "send_session_invite");

  // Старые сессии (созданные до видео-интеграции) могут не иметь
  // jitsi_room_name — достраиваем детерминированно по тем же правилам,
  // что и createSession, чтобы приглашение работало и для них.
  const roomName = (session.jitsi_room_name as string | null) || buildJitsiRoomName(session.id as string);
  const roomUrl = buildJitsiUrl(roomName);

  const text = roomUrl
    ? `Ссылка на видеовстречу: ${roomUrl}`
    : "Ссылка на видеовстречу будет доступна после подключения видеосервера.";
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
        ? "Приглашение с рабочей ссылкой на видеокомнату отправлено клиенту в Telegram."
        : "Приглашение сохранено. У клиента нет привязанного Telegram (или бот не подключён) — отправка станет доступна после привязки.",
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
    case "find_client_by_name":
      return findClientByName(ctx, args as { name_query: string });
    case "get_client_info":
      return getClientInfo(ctx, args as { client_id: string });
    case "create_client":
      return createClient(ctx, args as { name: string; request?: string; approach?: string; telegram?: string; phone?: string });
    case "update_client":
      return updateClient(ctx, args as { client_id: string; fields: Record<string, unknown> });
    case "search_client_history":
      return searchClientHistory(ctx, args as { client_id: string; query: string });
    case "get_test_results":
      return getTestResults(ctx, args as { client_id: string });
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
    case "send_broadcast_message":
      return sendBroadcastMessage(ctx, args as { text: string });
    default:
      throw new AgentToolError(`Неизвестный инструмент: ${name}`, String(name));
  }
}
