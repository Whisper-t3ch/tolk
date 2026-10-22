// ============================================================
// ИИ-анализы по кнопке (каждый стоит 1 запрос из лимита ассистента, ASSISTANT_REQUEST_COST.aiAnalysis):
//  - overview: обзор клиента по протоколам сессий, тестам и отметкам состояния;
//  - test: анализ динамики одной методики;
//  - session: разбор одной сессии + ИИ-оценка состояния клиента 0–10.
// Транскрипты в БД уже анонимизированы «на входе» (см. /api/webhooks/recording), здесь читаются готовыми.
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { yandexGptCompleteJson, YandexGptError } from "@/lib/yandexgpt";
import { checkResponseSafety } from "@/lib/agent/responseGuard";
import { TEST_SCALES, type TestType } from "@/lib/testScales";

export class AiAnalysisError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export type AnalysisKind = "overview" | "test" | "session";

const RULES = `Опирайся только на переданные данные. Не ставь диагнозов и клинических ярлыков, не давай медицинских назначений.
Пиши по-русски, коротко и по делу, для психолога-практика. Если данных по пункту недостаточно, так и напиши одной фразой.
Отвечай одним JSON-объектом с ровно указанными ключами на английском, значения — непустые строки (списки оформляй строками с тире).`;

const OVERVIEW_KEYS = ["dynamics", "strengths", "supports", "interventions", "homework", "attention", "next_focus"] as const;
const TEST_KEYS = ["summary", "dynamics", "interpretation", "recommendations"] as const;
export const SESSION_KEYS = [
  "state_score", "score_rationale", "key_themes", "strengths", "supports", "growth", "alliance", "interventions", "identity", "homework", "next_focus",
] as const;
/** Без этих блоков итоги сессии считаются неполными (остальные могут быть «недостаточно данных»). */
const SESSION_REQUIRED = ["strengths", "supports", "growth", "interventions"] as const;

const PROMPTS: Record<AnalysisKind, string> = {
  overview: `Ты клинический ассистент психолога. По протоколам сессий, результатам тестов и отметкам состояния составь обзор работы с клиентом.
Ключи JSON: "dynamics" (динамика состояния и работы), "strengths" (сильные стороны клиента), "supports" (точки опоры и ресурсы), "interventions" (какие интервенции и техники применялись и как отозвались), "homework" (домашние задания и их выполнение), "attention" (на что обратить внимание: риски, застревания), "next_focus" (предложения, на чём сфокусироваться дальше).
${RULES}`,
  test: `Ты клинический ассистент психолога. Проанализируй динамику одной методики у клиента по списку замеров.
Ключи JSON: "summary" (общий вывод в 1–2 предложениях), "dynamics" (как менялись баллы и что это значит), "interpretation" (как читать последний результат с учётом шкалы), "recommendations" (что обсудить с клиентом, когда повторить тест).
Учитывай направление шкалы, оно указано в данных. Результат теста — скрининговый ориентир, а не диагноз.
${RULES}`,
  session: `Ты ассистент-супервизор психолога. Разбери одну сессию по транскрипту или протоколу и составь итоги для самого психолога. Обращайся к нему на «вы», тёплым профессиональным тоном. Клиенту диагнозов не ставь.
Опирайся только на материал сессии: ничего не выдумывай, фразы цитируй коротко и только дословно из материала. Про то, что происходило у психолога внутри (чувства, контрперенос), пиши как осторожное предположение («возможно, вы чувствовали…»).
Ключи JSON:
"state_score" (ЧИСЛО от 0 до 10: оценка состояния клиента на этой сессии по тому, что прозвучало; 0 — очень тяжёлое, 10 — хорошее, устойчивое),
"score_rationale" (на чём основана оценка, 1–2 предложения),
"key_themes" (ключевые темы сессии),
"strengths" (Ваши сильные стороны: 2–3 пункта. Каждый: название; строка «Значимость для терапии: Ключевая / Важная / Вспомогательная»; строка «Что именно было сделано удачно:» с конкретикой из сессии),
"supports" (Точки опоры: 2–3 пункта, на что вы можете опереться в сложный момент. Каждый: название; «Ресурс:»; «Использование:» (когда и как применить); «Напоминание себе:» (короткая фраза от первого лица)),
"growth" (Идеи и возможности роста: 2–3 мягких предложения, что можно попробовать дальше, с опорой на конкретные моменты сессии),
"alliance" (Терапевтический альянс и контрперенос: качество контакта, что могло происходить у вас в процессе),
"interventions" (Эффективность интервенций: по каждой заметной интервенции «Интервенция:», «Эффективность:» высокая / средняя / низкая / неясно и обоснование по реакции клиента),
"identity" (Профессиональная идентичность: какой образ психолога мог переживать клиент и какие профессиональные качества проявились),
"homework" (какие задания обсуждались или стоит дать),
"next_focus" (на чём сфокусироваться дальше).
Каждое значение — не длиннее 900 символов.
${RULES}`,
};

function valueToText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.map(valueToText).filter(Boolean).map(x => `— ${x}`).join("\n");
  if (v && typeof v === "object") return Object.values(v as Record<string, unknown>).map(valueToText).filter(Boolean).join("\n");
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** Достаёт нужные ключи из ответа модели (она иногда оборачивает объект или меняет регистр ключей). */
export function normalizeAnalysis(raw: unknown, keys: readonly string[]): Record<string, string> {
  let obj: Record<string, unknown> = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const own = Object.keys(obj);
  if (own.length === 1 && obj[own[0]] && typeof obj[own[0]] === "object" && !Array.isArray(obj[own[0]])) {
    obj = obj[own[0]] as Record<string, unknown>;
  }
  const lower = new Map(Object.keys(obj).map(k => [k.toLowerCase().replace(/[\s-]+/g, "_"), k]));
  const out: Record<string, string> = {};
  for (const k of keys) {
    const real = obj[k] !== undefined ? k : lower.get(k);
    out[k] = valueToText(real !== undefined ? obj[real] : undefined);
  }
  return out;
}

export function parseScore(text: string): number | null {
  const m = text.replace(",", ".").match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}

async function runModel(system: string, user: string, keys: readonly string[], sessionKey: string, required: readonly string[], maxTokens?: number) {
  const messages = [
    { role: "system" as const, text: system },
    { role: "user" as const, text: user },
  ];
  const options = { sessionId: `tolk-ai-${sessionKey}`.slice(0, 80), ...(maxTokens ? { maxTokens } : {}) };
  const ok = (r: Record<string, string>) => required.every(k => r[k] && r[k].trim().length > 0);
  try {
    let result = normalizeAnalysis(await yandexGptCompleteJson<unknown>(messages, options), keys);
    if (!ok(result) || !checkResponseSafety(Object.values(result).join("\n")).safe) {
      result = normalizeAnalysis(await yandexGptCompleteJson<unknown>(messages, options), keys);
    }
    if (!ok(result)) throw new AiAnalysisError("Модель вернула неполный ответ. Попробуйте ещё раз (запрос не списан).");
    return result;
  } catch (e) {
    if (e instanceof AiAnalysisError) throw e;
    throw new AiAnalysisError(e instanceof YandexGptError ? e.message : "Не удалось получить ответ модели. Запрос не списан.");
  }
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
const dateOf = (iso: string) => new Date(iso).toISOString().slice(0, 10);

interface ClientRow { id: string; request: string | null; approach: string | null }

// ---------- overview ----------
export async function buildOverview(supabase: SupabaseClient, client: ClientRow) {
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, scheduled_at")
    .eq("client_id", client.id)
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: true })
    .limit(60);
  const sessionIds = (sessions ?? []).map(s => s.id as string);
  const when = new Map((sessions ?? []).map(s => [s.id as string, s.scheduled_at as string]));

  const { data: soap } = sessionIds.length
    ? await supabase.from("soap_notes").select("session_id, s_subjective, o_objective, a_assessment, p_plan").in("session_id", sessionIds)
    : { data: [] as Array<Record<string, string | null>> };
  const protocols = (soap ?? [])
    .map(n => ({ at: when.get(n.session_id as string) ?? "", n }))
    .filter(x => x.at)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-12)
    .map(({ at, n }) => {
      const parts = [
        n.s_subjective && `Жалоба/запрос: ${n.s_subjective}`,
        n.o_objective && `Наблюдения: ${n.o_objective}`,
        n.a_assessment && `Гипотеза: ${n.a_assessment}`,
        n.p_plan && `План: ${n.p_plan}`,
      ].filter(Boolean);
      return parts.length ? `=== Сессия ${dateOf(at)} ===\n${clip(parts.join("\n"), 2500)}` : null;
    })
    .filter((x): x is string => !!x);

  const { data: tests } = await supabase
    .from("test_results")
    .select("test_type, score, max_score, interpretation, created_at")
    .eq("client_id", client.id)
    .eq("status", "completed")
    .order("created_at", { ascending: true })
    .limit(80);
  const testLines = (tests ?? []).map(t => `${dateOf(t.created_at as string)} ${TEST_SCALES[t.test_type as TestType]?.label ?? t.test_type}: ${t.score}/${t.max_score}${t.interpretation ? ` (${t.interpretation})` : ""}`);

  const { data: progress } = await supabase
    .from("client_progress")
    .select("metric_type, value, note, recorded_at")
    .eq("client_id", client.id)
    .order("recorded_at", { ascending: true })
    .limit(80);
  const progressLines = (progress ?? []).map(p => `${dateOf(p.recorded_at as string)} ${p.metric_type}: ${p.value}/10${p.note ? ` — ${p.note}` : ""}`);

  if (protocols.length === 0 && testLines.length === 0 && progressLines.length === 0) {
    throw new AiAnalysisError("Пока нет данных для обзора: нужны протоколы сессий, результаты тестов или отметки состояния.", 422);
  }

  const user = [
    `Запрос клиента: ${client.request || "не указан"}. Подход психолога: ${client.approach || "не указан"}.`,
    protocols.length ? `ПРОТОКОЛЫ СЕССИЙ (${protocols.length}):\n${protocols.join("\n\n")}` : "Протоколов сессий нет.",
    testLines.length ? `ТЕСТЫ:\n${testLines.join("\n")}` : "Тестов нет.",
    progressLines.length ? `ОТМЕТКИ СОСТОЯНИЯ (0 плохо — 10 отлично):\n${progressLines.join("\n")}` : "Отметок состояния нет.",
  ].join("\n\n");

  const content = await runModel(PROMPTS.overview, clip(user, 45000), OVERVIEW_KEYS, `ov-${client.id}`, OVERVIEW_KEYS);
  return { content: { ...content, sessions_used: protocols.length, tests_used: testLines.length }, score: null as number | null };
}

// ---------- test ----------
export async function buildTestAnalysis(supabase: SupabaseClient, client: ClientRow, testType: string) {
  const { data: rows } = await supabase
    .from("test_results")
    .select("score, max_score, interpretation, created_at")
    .eq("client_id", client.id)
    .eq("test_type", testType)
    .eq("status", "completed")
    .order("created_at", { ascending: true })
    .limit(60);
  if (!rows || rows.length === 0) throw new AiAnalysisError("Нет завершённых замеров этого теста.", 422);

  const label = TEST_SCALES[testType as TestType]?.label ?? testType;
  const higherBetter = testType === "WHO5";
  const lines = rows.map(r => `${dateOf(r.created_at as string)}: ${r.score} из ${r.max_score}${r.interpretation ? ` — ${r.interpretation}` : ""}`);
  const user = [
    `Методика: ${label}. Направление шкалы: ${higherBetter ? "чем выше балл, тем лучше" : "чем ниже балл, тем лучше (если не указано иное для этой методики)"}.`,
    `Запрос клиента: ${client.request || "не указан"}.`,
    `Замеры по датам:\n${lines.join("\n")}`,
  ].join("\n");

  const content = await runModel(PROMPTS.test, user, TEST_KEYS, `t-${client.id}-${testType}`, TEST_KEYS);
  return { content: { ...content, test_label: label, measurements: rows.length }, score: null as number | null };
}

// ---------- session ----------
export async function buildSessionAnalysis(supabase: SupabaseClient, client: ClientRow, sessionId: string) {
  const { data: session } = await supabase
    .from("sessions")
    .select("id, scheduled_at")
    .eq("id", sessionId)
    .eq("client_id", client.id)
    .maybeSingle();
  if (!session) throw new AiAnalysisError("Сессия не найдена у этого клиента.", 404);

  const { data: tr } = await supabase
    .from("session_transcripts")
    .select("raw_text, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1);
  let material = tr?.[0]?.raw_text ? `ТРАНСКРИПТ СЕССИИ:\n${clip(tr[0].raw_text as string, 40000)}` : "";
  if (!material) {
    const { data: soap } = await supabase
      .from("soap_notes")
      .select("s_subjective, o_objective, a_assessment, p_plan")
      .eq("session_id", sessionId)
      .maybeSingle();
    const parts = soap
      ? [
          soap.s_subjective && `Жалоба/запрос: ${soap.s_subjective}`,
          soap.o_objective && `Наблюдения: ${soap.o_objective}`,
          soap.a_assessment && `Гипотеза: ${soap.a_assessment}`,
          soap.p_plan && `План: ${soap.p_plan}`,
        ].filter(Boolean)
      : [];
    if (parts.length) material = `ПРОТОКОЛ СЕССИИ (транскрипта нет):\n${parts.join("\n")}`;
  }
  if (!material) throw new AiAnalysisError("У этой сессии нет ни транскрипта, ни протокола, разбирать нечего.", 422);

  const user = `Запрос клиента: ${client.request || "не указан"}. Подход психолога: ${client.approach || "не указан"}.\nДата сессии: ${dateOf(session.scheduled_at as string)}.\n\n${material}`;
  const result = await runModel(PROMPTS.session, user, SESSION_KEYS, `s-${sessionId}`, SESSION_REQUIRED, 4000);
  const score = parseScore(result.state_score ?? "");
  if (score === null) throw new AiAnalysisError("Модель не вернула числовую оценку. Попробуйте ещё раз (запрос не списан).");
  return { content: { ...result, state_score: String(score), session_date: session.scheduled_at as string }, score };
}
