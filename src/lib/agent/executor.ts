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
import { expandSessionStarts, formatSessionStart, collectClientNames, type CreateSessionArgs } from "./scheduling";
import type { AgentToolName } from "./tools";
import { keywordSearchTranscripts } from "./keywordHistorySearch";
import { buildSessionPrep } from "./sessionPrep";

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
  args: { name?: string; names?: string[]; request?: string; approach?: string; telegram?: string; phone?: string }
) {
  const names = collectClientNames(args);
  if (names.length === 0) throw new AgentToolError("Не указано имя клиента", "create_client");

  const created: Array<{ id: string; name: string; status: string; request: string | null; approach: string | null }> = [];
  for (const name of names) {
    const { data, error } = await ctx.supabase
      .from("clients")
      .insert({
        psychologist_id: ctx.psychologistId,
        name,
        // Запрос/подход относятся к одному клиенту; при создании нескольких сразу не размазываем их на всех.
        request: names.length === 1 ? args.request ?? null : null,
        approach: names.length === 1 ? args.approach ?? null : null,
        status: "active",
      })
      .select("id, name, status, request, approach")
      .single();
    if (error) {
      if (created.length === 0) throw new AgentToolError(error.message, "create_client");
      // Часть уже создана — сообщаем, что получилось, а не теряем результат.
      return { clients: created, client: created[0], failed: names.slice(created.length), note: `Создано ${created.length} из ${names.length}, остановились на «${name}»: ${error.message}` };
    }
    created.push(data as (typeof created)[number]);
  }
  // telegram/phone пока негде хранить в схеме clients — учтено в описании ответа психологу.
  return {
    clients: created,
    client: created[0],
    note: args.telegram || args.phone ? "Telegram/телефон приняты, но пока не сохраняются — в схеме клиента нет таких полей." : undefined,
  };
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

interface SearchClientHistoryArgs {
  client_id: string;
  query?: string;
  session_position?: "first" | "last" | "first_n" | "last_n";
  session_position_count?: number;
  date_from?: string;
  date_to?: string;
}

// ------------------------------------------------------------
// Structure-aware history tool (21.09) — найдено при разборе провалов
// topK/domain routing (см. пост-мортемы ниже): worst-case "сравни
// первую и последнюю сессию" не семантический запрос вообще — это
// ДЕТЕРМИНИРОВАННЫЙ структурный вопрос о порядке сессий. Раньше
// searchClientHistory заставляла модель угадывать через similarity
// search по словам "первая"/"последняя", которые не имеют смысловой
// близости к содержанию сессий — отсюда несколько LLM-итераций и
// повышенная цена именно на этом сценарии (14.83₽ worst-case).
//
// Решение: если психолог спрашивает про ПОРЯДОК/ПЕРИОД (не тему),
// backend вычисляет нужные session_id напрямую — сортировкой уже
// прочитанного списка sessions клиента по scheduled_at, без похода в
// LLM за угадыванием и без семантического поиска. Раз сессия уже
// точно определена по позиции, резать её на чанки бессмысленно —
// возвращаем raw_text целиком (не top-k чанк), это не теряет контекст.
//
// Комбинация session_position/date + query остаётся возможной (сузить
// кандидатов по структуре, затем искать по смыслу внутри них) — но
// НЕ обязательна, в отличие от прежней версии, где query был required.
// ------------------------------------------------------------
async function searchClientHistory(ctx: ExecutorContext, args: SearchClientHistoryArgs) {
  const hasStructuralFilter = !!(args.session_position || args.date_from || args.date_to);

  let candidateSessionIds: string[] | null = null;
  let sessionsById: Map<string, { scheduled_at: string }> | null = null;

  if (hasStructuralFilter) {
    const { data: sessions, error: sessionsError } = await ctx.supabase
      .from("sessions")
      .select("id, scheduled_at")
      .eq("client_id", args.client_id)
      .eq("psychologist_id", ctx.psychologistId)
      .order("scheduled_at", { ascending: true });
    if (sessionsError) throw new AgentToolError(sessionsError.message, "search_client_history");
    if (!sessions || sessions.length === 0) {
      return { results: [], note: "У клиента нет сессий." };
    }

    let filtered = sessions as Array<{ id: string; scheduled_at: string }>;
    // scheduled_at — timestamptz ISO-строка, date_from/date_to от модели —
    // YYYY-MM-DD. Лексикографическое сравнение ISO-строк корректно
    // отражает хронологический порядок, но добавляем явное время суток,
    // чтобы "date_from=2026-06-01" включало сессии, начатые 1 июня в
    // любое время (без T00:00:00 сравнение всё равно сработало бы за
    // счёт префиксного порядка, но так явнее и симметрично date_to).
    if (args.date_from) filtered = filtered.filter(s => s.scheduled_at >= args.date_from! + "T00:00:00");
    if (args.date_to) filtered = filtered.filter(s => s.scheduled_at <= args.date_to! + "T23:59:59");

    // "Последняя/первая сессия" = сессия, по которой есть транскрипт. Без этого "last" выбирал
    // будущую запланированную сессию (транскрипта нет) и ассистент отвечал "записей нет".
    let sessionsBeforeTranscriptFilter: Array<{ id: string; scheduled_at: string }> = [];
    if (args.session_position && filtered.length > 0) {
      sessionsBeforeTranscriptFilter = filtered;
      const { data: withTranscript, error: wtError } = await ctx.supabase
        .from("session_transcripts")
        .select("session_id")
        .in("session_id", filtered.map(s => s.id));
      if (wtError) throw new AgentToolError(wtError.message, "search_client_history");
      const have = new Set((withTranscript ?? []).map(r => r.session_id as string));
      filtered = filtered.filter(s => have.has(s.id));
    }

    if (args.session_position) {
      const n = args.session_position_count && args.session_position_count > 0 ? args.session_position_count : 3;
      if (args.session_position === "first") filtered = filtered.slice(0, 1);
      else if (args.session_position === "last") filtered = filtered.slice(-1);
      else if (args.session_position === "first_n") filtered = filtered.slice(0, n);
      else if (args.session_position === "last_n") filtered = filtered.slice(-n);
    }

    if (filtered.length === 0) {
      if (sessionsBeforeTranscriptFilter.length > 0) {
        const past = sessionsBeforeTranscriptFilter.filter(x => x.scheduled_at <= new Date().toISOString());
        const lastDate = (past.length ? past[past.length - 1] : sessionsBeforeTranscriptFilter[sessionsBeforeTranscriptFilter.length - 1]).scheduled_at.slice(0, 10);
        return {
          results: [],
          note: `Сессии у клиента есть (${sessionsBeforeTranscriptFilter.length}, последняя по дате ${lastDate}), но ни по одной нет транскрипта: запись или расшифровка не загружены. Не говори, что сессий не было; скажи, что содержания сессий нет, и предложи загрузить транскрипт.`,
        };
      }
      return { results: [], note: "Нет сессий, удовлетворяющих заданному периоду/позиции." };
    }

    candidateSessionIds = filtered.map(s => s.id);
    sessionsById = new Map(filtered.map(s => [s.id, { scheduled_at: s.scheduled_at }]));
  }

  // Без query, но со структурным фильтром — сессии уже точно определены,
  // семантический поиск не нужен: отдаём raw_text целиком.
  if (hasStructuralFilter && !args.query) {
    const { data: transcripts, error: transcriptsError } = await ctx.supabase
      .from("session_transcripts")
      .select("session_id, raw_text, created_at")
      .in("session_id", candidateSessionIds!)
      .order("created_at", { ascending: false });
    if (transcriptsError) throw new AgentToolError(transcriptsError.message, "search_client_history");

    const latestBySession = new Map<string, string>();
    for (const t of transcripts ?? []) {
      const sid = t.session_id as string;
      if (!latestBySession.has(sid) && t.raw_text) latestBySession.set(sid, t.raw_text as string);
    }

    const results = candidateSessionIds!
      .filter(id => latestBySession.has(id))
      .map(id => ({
        session_id: id,
        raw_text: latestBySession.get(id)!,
        similarity: 1,
        scheduled_at: sessionsById!.get(id)!.scheduled_at,
      }));

    if (results.length === 0) {
      return { results: [], note: "Для выбранных сессий транскрипт ещё не готов." };
    }
    return { results };
  }

  // Есть query (с фильтром или без) — семантический поиск, как раньше,
  // но при наличии candidateSessionIds RPC сужает поиск только на них.
  if (!args.query) {
    throw new AgentToolError(
      "Укажи query (о чём искать) или session_position/date_from/date_to (какие сессии нужны).",
      "search_client_history"
    );
  }

  // Без эмбеддингов (стек без Яндекса) или если смысловой поиск ничего не дал (у транскрипта нет чанков) —
  // ищем по словам в полных транскриптах клиента.
  const keywordFallback = async () => {
    let sq = ctx.supabase
      .from("sessions")
      .select("id, scheduled_at")
      .eq("client_id", args.client_id)
      .eq("psychologist_id", ctx.psychologistId);
    if (candidateSessionIds) sq = sq.in("id", candidateSessionIds);
    const { data: sess, error: sErr } = await sq;
    if (sErr) throw new AgentToolError(sErr.message, "search_client_history");
    const ids = (sess ?? []).map(x => x.id as string);
    if (ids.length === 0) return { results: [], note: "У клиента нет сессий." };
    const { data: tr, error: tErr } = await ctx.supabase
      .from("session_transcripts")
      .select("session_id, raw_text, created_at")
      .in("session_id", ids)
      .order("created_at", { ascending: false });
    if (tErr) throw new AgentToolError(tErr.message, "search_client_history");
    const at = new Map((sess ?? []).map(x => [x.id as string, x.scheduled_at as string]));
    const latest = new Map<string, string>();
    for (const r of tr ?? []) if (!latest.has(r.session_id as string) && r.raw_text) latest.set(r.session_id as string, r.raw_text as string);
    const found = keywordSearchTranscripts(
      args.query!,
      Array.from(latest.entries()).map(([session_id, raw_text]) => ({ session_id, raw_text, scheduled_at: at.get(session_id)! }))
    );
    if (found.length === 0) {
      return { results: [], note: `В транскриптах (${latest.size} шт.) не нашлось упоминаний по запросу «${args.query}». Попробуй другие слова или session_position, чтобы прочитать сессии целиком.` };
    }
    return {
      mode: "keyword",
      total_sessions_with_transcript: latest.size,
      note: "Это дословные фрагменты сессий. Отвечай только тем, что в них сказано; чего в них нет — не додумывай. Порядок событий — по номерам сессий.",
      results: found,
    };
  };

  let queryEmbedding: Awaited<ReturnType<typeof yandexGptEmbed>>;
  try {
    queryEmbedding = await yandexGptEmbed(args.query, "query");
  } catch {
    return keywordFallback();
  }

  // match_session_transcript_chunks (не match_session_transcripts) —
  // см. migration_034_session_transcript_chunks.sql. Embedding на
  // уровне целой сессии больше не считается (YandexGPT Embeddings
  // ограничен 2048 токенами на вход, часовая сессия обычно крупнее),
  // поиск идёт по чанкам ~1050 символов каждый (см. lib/transcriptChunking.ts).
  const { data, error } = await ctx.supabase.rpc("match_session_transcript_chunks", {
    query_embedding: queryEmbedding,
    match_client_id: args.client_id,
    match_psychologist_id: ctx.psychologistId,
    // Берём больше чанков, чем нужно результатов — несколько лучших
    // чанков могут прийти из одной и той же сессии, схлопываем ниже.
    //
    // ЭКСПЕРИМЕНТ topK 5→3 ОТКАЧЕН: тест на клиенте с 10 сессиями
    // (см. "Шаг 1") показал стабильную деградацию на широких вопросах
    // ("сравни первую и последнюю сессию") — агент дважды подряд не
    // находил нужные сессии и переспрашивал период вместо ответа,
    // хотя с topK=5 тот же вопрос отвечался с первого раза. Разница в
    // цене между вопросами объясняется не общим числом найденных
    // сессий, а тем, сколько из них модель реально использует —
    // снижать topK, чтобы сэкономить на этом, оказалось рискованно
    // именно там, где широкий охват нужнее всего. (21.09: теперь этот
    // конкретный worst-case перехватывается structural-путём выше и
    // вообще не доходит до similarity search — но topK всё равно не
    // трогаем для остальных смысловых вопросов, риск тот же.)
    match_count: 15,
  });

  if (error) {
    // Например, размерность эмбеддинга не совпала с колонкой (до миграции на 1024) — не роняем
    // ответ психологу, а ищем по словам.
    console.error("SEMANTIC_SEARCH_FALLBACK", error.message);
    return keywordFallback();
  }

  // chunk_text уже анонимизирован на этапе сохранения (анонимизация
  // применяется к целому raw_text до чанкинга, см.
  // lib/transcriptChunking.ts) — повторная анонимизация не нужна.
  let rows = (data ?? []) as Array<{ session_id: string; chunk_text: string; similarity: number; scheduled_at: string }>;

  // Сужаем до кандидатов, определённых структурным фильтром выше (если
  // он был задан вместе с query) — RPC ищет по всей истории клиента,
  // фильтрация по session_id делается здесь на JS-стороне.
  if (candidateSessionIds) {
    const candidateSet = new Set(candidateSessionIds);
    rows = rows.filter(r => candidateSet.has(r.session_id));
  }

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

  if (results.length === 0) return keywordFallback();
  return { results };
}

// Использует общую buildPeriodSummary (см. lib/prompts/periodSummary.ts)
// — раньше здесь была независимая копия логики /api/clients/[id]/summary,
// которая разошлась по поведению. Лимит здесь НЕ списывается отдельно:
// /api/assistant уже списывает "agentTask" (1 запрос) за всю цепочку вызовов
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
async function prepareSession(ctx: ExecutorContext, args: { client_id: string }) {
  const { data: sessions, error } = await ctx.supabase
    .from("sessions")
    .select("id, scheduled_at")
    .eq("client_id", args.client_id)
    .eq("psychologist_id", ctx.psychologistId)
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: false })
    .limit(13);
  if (error) throw new AgentToolError(error.message, "prepare_session");
  const ids = (sessions ?? []).map(s => s.id as string);
  if (ids.length === 0) return { results: [], note: "У клиента ещё не было сессий." };
  const [{ data: tr }, { data: soap }] = await Promise.all([
    ctx.supabase.from("session_transcripts").select("session_id, raw_text, created_at").in("session_id", ids).order("created_at", { ascending: false }),
    ctx.supabase.from("soap_notes").select("session_id, a_assessment, p_plan").in("session_id", ids),
  ]);
  const transcriptBy = new Map<string, string>();
  for (const t of tr ?? []) if (!transcriptBy.has(t.session_id as string) && t.raw_text) transcriptBy.set(t.session_id as string, t.raw_text as string);
  const soapBy = new Map((soap ?? []).map(n => [n.session_id as string, n as { a_assessment?: string | null; p_plan?: string | null }]));
  const prep = buildSessionPrep(
    (sessions ?? []).map(s => ({
      id: s.id as string,
      scheduled_at: s.scheduled_at as string,
      transcript: transcriptBy.get(s.id as string) ?? null,
      soap: soapBy.get(s.id as string) ?? null,
    }))
  );
  if (!prep) return { results: [], note: "По прошедшим сессиям нет ни транскриптов, ни протоколов." };
  const tests = await getTestResults(ctx, args);
  const recentTests = "results" in tests && Array.isArray(tests.results) ? tests.results.slice(-3) : [];
  return { ...prep, recent_tests: recentTests };
}

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
    .gte("scheduled_at", dayStart(args.date_from))
    .lte("scheduled_at", dayEnd(args.date_to))
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

  const results = data ?? [];

  // Веб-поиск при пустой базе знаний (21.09) — НЕ новый инструмент в
  // схеме function calling (это осталось бы вне схемы 18, см. решение
  // от 21.09 про исчерпанную ветку "сузить/расширить список
  // инструментов"), а просто данные внутри результата уже существующего
  // вызова search_knowledge_base. Модель видит suggestWebSearch в этом
  // же tool result и по инструкции в AGENT_SYSTEM_PROMPT предлагает
  // психологу веб-поиск текстом — сам веб-поиск, если психолог
  // согласится, идёт отдельным узким путём (/api/assistant/web-search),
  // который не проходит через основной agent loop и не платит за схему
  // 18 инструментов вообще.
  if (results.length === 0) {
    return { results, suggestWebSearch: true, query: args.query };
  }

  return { results };
}

// ------------------------------------------------------------
// РАСПИСАНИЕ
// ------------------------------------------------------------

// Модель передаёт границы периода как YYYY-MM-DD. Сравнение timestamptz с
// голой датой трактует её как полночь, из-за чего .lte(date_to) отбрасывает
// весь последний день (сессии "на завтра" не находились). Расширяем границы
// до начала/конца суток; значения с временем оставляем как есть.
function localDayBound(d: string, time: string, timeZone: string | undefined, endOfMinute = false): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const utc = zonedDateTimeToUtc(d, time, timeZone || DEFAULT_TIMEZONE);
  return new Date(utc.getTime() + (endOfMinute ? 59_999 : 0)).toISOString();
}
function dayStart(d: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : d;
}
function dayEnd(d: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T23:59:59` : d;
}

async function getSchedule(ctx: ExecutorContext, args: { date_from: string; date_to: string }) {
  const { data, error } = await ctx.supabase
    .from("sessions")
    .select("id, client_id, scheduled_at, duration_minutes, status, clients ( name )")
    .gte("scheduled_at", localDayBound(args.date_from, "00:00", ctx.timeZone))
    .lte("scheduled_at", localDayBound(args.date_to, "23:59", ctx.timeZone, true))
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: true });
  if (error) throw new AgentToolError(error.message, "get_schedule");
  // Время отдаём уже в поясе психолога: из UTC-строки модель называла 14:00 вместо 17:00 по Москве.
  const tz = ctx.timeZone || DEFAULT_TIMEZONE;
  return {
    time_zone: tz,
    sessions: (data ?? []).map(s => {
      const at = new Date(s.scheduled_at as string);
      return { ...s, local_date: formatDateInTimeZone(at, tz), local_time: formatTimeInTimeZone(at, tz) };
    }),
  };
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

async function createSession(ctx: ExecutorContext, args: CreateSessionArgs & { client_id: string }) {
  const timeZone = ctx.timeZone ?? DEFAULT_TIMEZONE;
  let starts: Date[];
  try {
    starts = expandSessionStarts(args, timeZone);
  } catch (e) {
    throw new AgentToolError(e instanceof Error ? e.message : "Некорректные дата/время", "create_session");
  }
  const duration = args.duration_minutes ?? 50;

  // Не создаём сессии поверх уже назначенных.
  const rangeFrom = new Date(starts[0].getTime() - 12 * 3600_000).toISOString();
  const rangeTo = new Date(starts[starts.length - 1].getTime() + 12 * 3600_000).toISOString();
  const { data: busy } = await ctx.supabase
    .from("sessions")
    .select("scheduled_at, duration_minutes")
    .eq("psychologist_id", ctx.psychologistId)
    .neq("status", "cancelled")
    .gte("scheduled_at", rangeFrom)
    .lte("scheduled_at", rangeTo);
  const busyIntervals = (busy ?? []).map(b => {
    const st = new Date(b.scheduled_at as string).getTime();
    return { start: st, end: st + ((b.duration_minutes as number | null) ?? 50) * 60_000 };
  });

  const createdSessions: Array<{ id: string; client_id: string; scheduled_at: string; duration_minutes: number; status: string; label: string; video_room_url: string | null }> = [];
  const skipped: string[] = [];
  const jitsiReady = checkJitsiEnv().configured;

  for (const start of starts) {
    const s0 = start.getTime();
    const e0 = s0 + duration * 60_000;
    if (busyIntervals.some(b => s0 < b.end && e0 > b.start)) {
      skipped.push(formatSessionStart(start, timeZone));
      continue;
    }
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
        scheduled_at: start.toISOString(),
        duration_minutes: duration,
        status: "scheduled",
        jitsi_room_name: roomName,
      })
      .select("id, client_id, scheduled_at, duration_minutes, status")
      .single();
    if (error) {
      if (createdSessions.length === 0) throw new AgentToolError(error.message, "create_session");
      skipped.push(formatSessionStart(start, timeZone));
      continue;
    }
    busyIntervals.push({ start: s0, end: e0 });
    createdSessions.push({ ...(data as { id: string; client_id: string; scheduled_at: string; duration_minutes: number; status: string }), label: formatSessionStart(start, timeZone), video_room_url: buildJitsiUrl(roomName) || null });
  }

  if (createdSessions.length === 0) {
    throw new AgentToolError(`Это время занято: ${skipped.join("; ")}.`, "create_session");
  }

  return {
    sessions: createdSessions,
    session: createdSessions[0],
    skipped_busy: skipped.length ? skipped : undefined,
    note: jitsiReady
      ? "Сессия создана, ссылка на видеокомнату готова."
      : "Сессия создана. Ссылка на видеокомнату станет рабочей после развёртывания видеосервера (ВМ ещё не подключена).",
  };
}

/** Сессия психолога для проверок перед отменой/переносом/отправкой ссылки. */
async function loadOwnSession(ctx: ExecutorContext, sessionId: string, tool: string) {
  const { data } = await ctx.supabase
    .from("sessions")
    .select("id, client_id, scheduled_at, duration_minutes, status")
    .eq("id", sessionId)
    .eq("psychologist_id", ctx.psychologistId)
    .maybeSingle();
  if (!data) {
    throw new AgentToolError(
      "Такой сессии нет. Не придумывай id: возьми его из get_client_info (recent_sessions) или get_schedule; id клиента подставлять нельзя.",
      tool
    );
  }
  return data as { id: string; client_id: string; scheduled_at: string; duration_minutes: number | null; status: string };
}

async function cancelSession(ctx: ExecutorContext, args: { session_id: string; reason?: string }) {
  const session = await loadOwnSession(ctx, args.session_id, "cancel_session");
  if (session.status === "cancelled") throw new AgentToolError("Эта сессия уже отменена", "cancel_session");
  if (new Date(session.scheduled_at).getTime() < Date.now()) {
    throw new AgentToolError("Эта сессия уже прошла — отменять её нельзя", "cancel_session");
  }
  const patch: Record<string, unknown> = { status: "cancelled" };
  if (args.reason) patch.notes = `Отменена: ${args.reason}`;
  const { data, error } = await ctx.supabase
    .from("sessions")
    .update(patch)
    .eq("id", args.session_id)
    .eq("psychologist_id", ctx.psychologistId)
    .select("id, status")
    .single();
  if (error) throw new AgentToolError(error.message, "cancel_session");
  return { session: data };
}

async function rescheduleSession(ctx: ExecutorContext, args: { session_id: string; date?: string; time?: string }) {
  const timeZone = ctx.timeZone ?? DEFAULT_TIMEZONE;
  const session = await loadOwnSession(ctx, args.session_id, "reschedule_session");
  if (session.status === "cancelled") throw new AgentToolError("Эта сессия отменена — переносить нечего", "reschedule_session");
  if (new Date(session.scheduled_at).getTime() < Date.now()) {
    throw new AgentToolError("Эта сессия уже прошла — переносить её нельзя", "reschedule_session");
  }
  let starts: Date[];
  try {
    starts = expandSessionStarts({ date: args.date, time: args.time }, timeZone);
  } catch (e) {
    throw new AgentToolError(e instanceof Error ? e.message : "Некорректные дата/время", "reschedule_session");
  }
  const start = starts[0];
  const duration = session.duration_minutes ?? 50;
  const { data: busy } = await ctx.supabase
    .from("sessions")
    .select("id, scheduled_at, duration_minutes")
    .eq("psychologist_id", ctx.psychologistId)
    .neq("status", "cancelled")
    .neq("id", session.id)
    .gte("scheduled_at", new Date(start.getTime() - 12 * 3600_000).toISOString())
    .lte("scheduled_at", new Date(start.getTime() + 12 * 3600_000).toISOString());
  const s0 = start.getTime();
  const e0 = s0 + duration * 60_000;
  const clash = (busy ?? []).some(b => {
    const bs = new Date(b.scheduled_at as string).getTime();
    return s0 < bs + ((b.duration_minutes as number | null) ?? 50) * 60_000 && e0 > bs;
  });
  if (clash) throw new AgentToolError(`Это время занято: ${formatSessionStart(start, timeZone)}`, "reschedule_session");
  const { data, error } = await ctx.supabase
    .from("sessions")
    .update({ scheduled_at: start.toISOString() })
    .eq("id", session.id)
    .eq("psychologist_id", ctx.psychologistId)
    .select("id, client_id, scheduled_at, duration_minutes, status")
    .single();
  if (error) throw new AgentToolError(error.message, "reschedule_session");
  return { session: data, label: formatSessionStart(start, timeZone) };
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
  // Диагностика на стенде: LOG_TOOL_CALLS=1 пишет имя инструмента и аргументы (без результатов).
  if (process.env.LOG_TOOL_CALLS === "1") console.log("TOOL_CALL", name, JSON.stringify(args));
  // Слабые модели выдумывают client_id. Без этой проверки инструмент отвечает «у клиента нет сессий»,
  // и модель уверенно передаёт психологу неправду. Проверяем, что клиент существует и принадлежит психологу.
  if (typeof args?.client_id === "string" && name !== "create_client") {
    const { data: owned } = await ctx.supabase
      .from("clients")
      .select("id")
      .eq("id", args.client_id)
      .eq("psychologist_id", ctx.psychologistId)
      .maybeSingle();
    if (!owned) {
      throw new AgentToolError(
        `Клиента с id "${args.client_id}" нет. Не придумывай id: возьми его из контекста запроса или вызови find_client_by_name с именем клиента.`,
        name
      );
    }
  }
  switch (name as AgentToolName) {
    case "get_clients":
      return getClients(ctx);
    case "find_client_by_name":
      return findClientByName(ctx, args as { name_query: string });
    case "get_client_info":
      return getClientInfo(ctx, args as { client_id: string });
    case "create_client":
      return createClient(ctx, args as { name?: string; names?: string[]; request?: string; approach?: string; telegram?: string; phone?: string });
    case "update_client":
      return updateClient(ctx, args as { client_id: string; fields: Record<string, unknown> });
    case "search_client_history":
      return searchClientHistory(ctx, args as unknown as SearchClientHistoryArgs);
    case "prepare_session":
      return prepareSession(ctx, args as { client_id: string });
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
      return createSession(ctx, args as unknown as CreateSessionArgs & { client_id: string });
    case "cancel_session":
      return cancelSession(ctx, args as { session_id: string; reason?: string });
    case "reschedule_session":
      return rescheduleSession(ctx, args as { session_id: string; date?: string; time?: string });
    case "send_message_to_client":
      return sendMessageToClient(ctx, args as { client_id: string; text: string; channel: "telegram" | "vk" | "max" });
    case "send_homework":
      return sendHomework(ctx, args as { client_id: string; homework_text: string });
    case "send_session_invite":
      await loadOwnSession(ctx, String((args as { session_id?: string }).session_id ?? ""), "send_session_invite");
      return sendSessionInvite(ctx, args as { session_id: string });
    case "send_broadcast_message":
      return sendBroadcastMessage(ctx, args as { text: string });
    default:
      throw new AgentToolError(`Неизвестный инструмент: ${name}`, String(name));
  }
}
