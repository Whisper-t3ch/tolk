// ============================================================
// Автоматические итоги после сессии: как только расшифровка записи готова, платформа
//  1) создаёт черновик протокола SOAP, если протокола ещё нет (бесплатно для лимита, как и ручная генерация);
//  2) готовит «Итоги сессии» для психолога (сильные стороны, точки опоры, рост, альянс, интервенции,
//     профессиональная идентичность + ИИ-оценка состояния клиента) за 1 запрос из лимита ассистента.
// Работает от имени сервиса (admin-клиент), best-effort: любой сбой только пишется в лог и ничего не роняет.
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { yandexGptComplete, YandexGptError } from "@/lib/yandexgpt";
import { buildSoapUserMessage, selectSoapSystemPrompt } from "@/lib/prompts/soap";
import { guardSoapDraft, parseSoapJson } from "@/lib/soap/groundedness";
import { buildGroundingCorpus, loadSoapSourceMaterial } from "@/lib/soap/sourceMaterial";
import { assessTranscriptQuality, countMeaningfulWords, MIN_NOTES_WORDS } from "@/lib/soap/transcriptQuality";
import { AiAnalysisError, buildSessionAnalysis } from "@/lib/prompts/aiAnalysis";

export interface AutoSummaryResult {
  soap: "created" | "exists" | "skipped" | "failed";
  summary: "created" | "exists" | "no_limit" | "skipped" | "failed";
}

async function autoSoap(admin: SupabaseClient, p: { sessionId: string; clientId: string; psychologistId: string; clientName: string }): Promise<AutoSummaryResult["soap"]> {
  const { data: existing } = await admin
    .from("soap_notes")
    .select("id, s_subjective, o_objective, a_assessment, p_plan")
    .eq("session_id", p.sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const hasContent = existing && [existing.s_subjective, existing.o_objective, existing.a_assessment, existing.p_plan].some(v => typeof v === "string" && v.trim());
  if (hasContent) return "exists";

  const material = await loadSoapSourceMaterial(admin, { sessionId: p.sessionId, clientId: p.clientId, psychologistId: p.psychologistId });
  const verdict = material.transcript ? assessTranscriptQuality(material.transcript, material.transcriptDurationSeconds) : null;
  const useTranscript = verdict?.ok === true;
  if (!useTranscript && countMeaningfulWords(material.notes) < MIN_NOTES_WORDS) return "skipped";

  const messages = [
    { role: "system" as const, text: selectSoapSystemPrompt(useTranscript) },
    {
      role: "user" as const,
      text: buildSoapUserMessage({
        transcript: useTranscript ? material.transcript : undefined,
        notes: material.notes,
        previousSessionsSummary: material.previousSessionsSummary,
        clientName: p.clientName,
        sessionNumber: material.sessionNumber,
      }),
    },
  ];
  const text = await yandexGptComplete(messages, { model: "pro", maxTokens: 2000, temperature: 0.3 });
  const { result, issues } = guardSoapDraft(parseSoapJson(text), buildGroundingCorpus(material));
  if (issues.length > 0) console.log("SOAP_GUARD", JSON.stringify(issues));

  const patch = { s_subjective: result.s, o_objective: result.o, a_assessment: result.a, p_plan: result.p, ai_generated: true };
  const { error } = existing
    ? await admin.from("soap_notes").update(patch).eq("id", existing.id)
    : await admin.from("soap_notes").insert({ session_id: p.sessionId, ...patch });
  if (error) throw new Error(error.message);
  return "created";
}

async function autoSummary(admin: SupabaseClient, p: { sessionId: string; clientId: string; psychologistId: string; request: string | null; approach: string | null }): Promise<AutoSummaryResult["summary"]> {
  const { data: existing } = await admin
    .from("client_ai_analyses")
    .select("id")
    .eq("client_id", p.clientId)
    .eq("kind", "session")
    .eq("ref", p.sessionId)
    .limit(1);
  if (existing && existing.length > 0) return "exists";

  let built;
  try {
    built = await buildSessionAnalysis(admin, { id: p.clientId, request: p.request, approach: p.approach }, p.sessionId);
  } catch (e) {
    if (e instanceof AiAnalysisError && e.status === 422) return "skipped";
    throw e;
  }
  const { error } = await admin.from("client_ai_analyses").insert({
    psychologist_id: p.psychologistId,
    client_id: p.clientId,
    kind: "session",
    ref: p.sessionId,
    content: built.content,
    score: built.score,
    auto: true,
  });
  if (error) throw new Error(error.message);
  return "created"; // резюме сессии бесплатное: запросы ассистента не списываются
}

/** Запускать после готовой расшифровки. Не бросает исключений. */
export async function runAutoSessionSummary(admin: SupabaseClient, sessionId: string): Promise<AutoSummaryResult> {
  const out: AutoSummaryResult = { soap: "skipped", summary: "skipped" };
  try {
    const { data: session } = await admin
      .from("sessions")
      .select("id, client_id, psychologist_id, clients ( name, request, approach )")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session) return out;
    const rel = Array.isArray(session.clients) ? session.clients[0] : session.clients;
    const client = (rel ?? {}) as { name?: string; request?: string | null; approach?: string | null };
    const base = { sessionId, clientId: session.client_id as string, psychologistId: session.psychologist_id as string };

    try {
      out.soap = await autoSoap(admin, { ...base, clientName: client.name ?? "Клиент" });
    } catch (e) {
      out.soap = "failed";
      console.error("AUTO_SOAP_FAILED", sessionId, e instanceof YandexGptError ? e.message : e instanceof Error ? e.message : "unknown");
    }
    try {
      out.summary = await autoSummary(admin, { ...base, request: client.request ?? null, approach: client.approach ?? null });
    } catch (e) {
      out.summary = "failed";
      console.error("AUTO_SUMMARY_FAILED", sessionId, e instanceof Error ? e.message : "unknown");
    }
    console.log("AUTO_SESSION_SUMMARY", JSON.stringify({ sessionId, ...out }));
  } catch (e) {
    console.error("AUTO_SESSION_SUMMARY_ERROR", sessionId, e instanceof Error ? e.message : "unknown");
  }
  return out;
}
