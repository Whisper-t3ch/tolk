import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { yandexGptGetAsyncOperation, YandexGptError } from "@/lib/yandexgpt";
import type { SoapResult } from "@/lib/prompts/soap";

// GET /api/sessions/[id]/soap/generate/status?job_id=...
//
// Опрашивается фронтендом с интервалом в несколько секунд после
// POST .../soap/generate (см. комментарий там про async-режим).
// Возвращает { status: "pending" } пока генерация не готова,
// { status: "done", soapNote } когда результат сохранён в soap_notes,
// или { status: "error", error } при сбое.
//
// Идемпотентно: повторный вызов после status="done" просто читает уже
// сохранённый soap_notes и не обращается к YandexGPT снова — важно, если
// фронтенд опросит статус ещё раз после того как уже получил результат
// (например, при повторном монтировании компонента).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const jobId = request.nextUrl.searchParams.get("job_id");
  if (!jobId) {
    return NextResponse.json({ error: "Укажите job_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { data: job, error: jobError } = await supabase
    .from("soap_generation_jobs")
    .select("id, session_id, operation_id, status, result, error_message, template_id")
    .eq("id", jobId)
    .eq("session_id", sessionId)
    .eq("psychologist_id", user.id)
    .maybeSingle();

  if (jobError) {
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: "Задача генерации не найдена" }, { status: 404 });
  }

  // Уже завершена раньше (этот же job опрашивается повторно) — читаем
  // готовый soap_notes, не обращаемся к YandexGPT снова.
  if (job.status === "done") {
    const soapNote = await loadSoapNote(supabase, sessionId);
    return NextResponse.json({ status: "done", soapNote });
  }
  if (job.status === "error") {
    return NextResponse.json({ status: "error", error: job.error_message ?? "Не удалось сгенерировать протокол" });
  }

  // status === "pending" — проверяем реальный статус операции в Yandex Cloud.
  let opStatus;
  try {
    opStatus = await yandexGptGetAsyncOperation(job.operation_id);
  } catch (e) {
    const message = e instanceof YandexGptError ? e.message : "Не удалось проверить статус генерации";
    return NextResponse.json({ status: "pending", note: message });
    // Не помечаем job как error из-за одного сбойного опроса — временная
    // сетевая проблема при следующем опросе может пройти нормально.
    // Постоянная ошибка (сама генерация упала) приходит через opStatus.error,
    // а не через исключение — см. ветку ниже.
  }

  if (!opStatus.done) {
    return NextResponse.json({ status: "pending" });
  }

  if (opStatus.error || opStatus.text === null) {
    const message = opStatus.error ?? "YandexGPT не вернул результат генерации";
    await supabase.from("soap_generation_jobs").update({ status: "error", error_message: message }).eq("id", jobId);
    return NextResponse.json({ status: "error", error: message });
  }

  // Готово — парсим JSON так же, как раньше делал yandexGptCompleteJson
  // (модель просит вернуть строгий JSON текстом, см. soap.ts JSON_CONTRACT).
  let result: SoapResult;
  try {
    const cleaned = opStatus.text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    result = JSON.parse(cleaned) as SoapResult;
  } catch {
    const message = "Не удалось разобрать ответ YandexGPT (не JSON)";
    await supabase.from("soap_generation_jobs").update({ status: "error", error_message: message }).eq("id", jobId);
    return NextResponse.json({ status: "error", error: message });
  }

  const patch = {
    s_subjective: result.s ?? "",
    o_objective: result.o ?? "",
    a_assessment: result.a ?? "",
    p_plan: result.p ?? "",
    ai_generated: true,
    protocol_template_id: job.template_id ?? null,
  };

  const { data: existing } = await supabase
    .from("soap_notes")
    .select("id")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const saveQuery = existing
    ? supabase.from("soap_notes").update(patch).eq("id", existing.id)
    : supabase.from("soap_notes").insert({ session_id: sessionId, ...patch });

  const { data: saved, error: saveError } = await saveQuery
    .select("id, s_subjective, o_objective, a_assessment, p_plan, updated_at")
    .single();

  if (saveError) {
    await supabase.from("soap_generation_jobs").update({ status: "error", error_message: saveError.message }).eq("id", jobId);
    return NextResponse.json({ status: "error", error: saveError.message });
  }

  await supabase.from("soap_generation_jobs").update({ status: "done" }).eq("id", jobId);

  return NextResponse.json({
    status: "done",
    soapNote: {
      id: saved.id,
      s: saved.s_subjective ?? "",
      o: saved.o_objective ?? "",
      a: saved.a_assessment ?? "",
      p: saved.p_plan ?? "",
      updatedAt: saved.updated_at,
    },
  });
}

async function loadSoapNote(supabase: Awaited<ReturnType<typeof createClient>>, sessionId: string) {
  const { data } = await supabase
    .from("soap_notes")
    .select("id, s_subjective, o_objective, a_assessment, p_plan, updated_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    s: data.s_subjective ?? "",
    o: data.o_objective ?? "",
    a: data.a_assessment ?? "",
    p: data.p_plan ?? "",
    updatedAt: data.updated_at,
  };
}
