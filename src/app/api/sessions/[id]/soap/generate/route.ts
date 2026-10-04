import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  checkYandexGptEnv,
  yandexGptStartAsyncCompletion,
  YandexGptError,
  isModerationRefusal,
} from "@/lib/yandexgpt";
import {
  buildSoapUserMessage,
  selectSoapSystemPrompt,
} from "@/lib/prompts/soap";
import { maskProfanity } from "@/lib/profanity";
import { MODERATION_MANUAL_MESSAGE } from "@/lib/soap/messages";
import { loadSoapSourceMaterial } from "@/lib/soap/sourceMaterial";
import {
  assessTranscriptQuality,
  countMeaningfulWords,
  INSUFFICIENT_DATA_MESSAGE,
  MIN_NOTES_WORDS,
} from "@/lib/soap/transcriptQuality";

// POST /api/sessions/[id]/soap/generate
// Body (опционально): { template_id?: string } — id материала из
// knowledge_base (source_type=protocol), выбранного психологом на
// странице протокола. Если указан, его текст передаётся модели как
// ориентир структуры/акцентов для блоков s/o/a/p (см. lib/prompts/soap.ts).
//
// АСИНХРОННЫЙ режим (с 17.09): вместо того чтобы ждать готовый текст в
// рамках этого же запроса, здесь только ЗАПУСКАЕТСЯ генерация через
// completionAsync и сразу возвращается { job_id } — фронтенд опрашивает
// GET /api/sessions/[id]/soap/generate/status?job_id=... каждые несколько
// секунд, пока не получит готовый результат. Экономика: async-режим
// примерно вдвое дешевле синхронного (0.61₽/1000 токенов вместо 1.2₽/1000
// для Pro) ценой задержки в несколько минут — SOAP генерируется уже ПОСЛЕ
// сессии, психолог не ждёт его в реальном времени, так что задержка не
// стоит психологу ничего, кроме времени, а не денег платформы.
//
// Раньше (до 17.09) это был синхронный yandexGptCompleteJson с мгновенным
// возвратом готового протокола — см. историю файла. Официальный пример
// тела запроса для completionAsync (aistudio.yandex.ru/docs/ru/ai-studio/
// operations/generation/async-request) не показывает поле jsonObject —
// не полагаемся на него здесь и не выдаём его отсутствие за факт, а просто
// парсим ответ так же, как раньше делал yandexGptCompleteJson: промпт
// soap.ts САМ требует строгий JSON текстом, полученный текст очищается от
// возможной markdown-обёртки и парсится вручную при получении результата
// (см. status/route.ts).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const envStatus = checkYandexGptEnv();
  if (!envStatus.configured) {
    return NextResponse.json(
      { error: `YandexGPT не настроен. Добавьте ключи в .env: ${envStatus.missing.join(", ")}` },
      { status: 503 }
    );
  }

  const { id: sessionId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { template_id?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Тело необязательно — генерация без выбранного шаблона (базовый формат).
  }

  let template: { id: string; title: string | null; content: string } | null = null;
  if (body.template_id) {
    const { data: templateRow, error: templateError } = await supabase
      .from("knowledge_base")
      .select("id, title, content")
      .eq("id", body.template_id)
      .eq("psychologist_id", user.id)
      .eq("source_type", "protocol")
      .maybeSingle();
    if (templateError) {
      return NextResponse.json({ error: templateError.message }, { status: 500 });
    }
    if (!templateRow) {
      return NextResponse.json({ error: "Выбранный шаблон протокола не найден" }, { status: 404 });
    }
    template = templateRow;
  }

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, scheduled_at, client_id, clients ( name )")
    .eq("id", sessionId)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }

  const clientRel = Array.isArray(session.clients) ? session.clients[0] : session.clients;
  const clientName = (clientRel as { name?: string } | null)?.name ?? "Клиент";
  const clientId = session.client_id as string;

  // Материалы: транскрипт (уже анонимизирован при сохранении — см.
  // lib/anonymize.ts, fail-closed), заметки психолога и резюме прошлых
  // сессий. Мат маскируется ещё раз здесь — защита для старых транскриптов
  // и для заметок, написанных вручную.
  const material = await loadSoapSourceMaterial(supabase, {
    sessionId,
    clientId,
    psychologistId: user.id,
  });

  // Порог качества: на пустом/слишком коротком/шумном транскрипте
  // черновик не генерируется (раньше модель сочиняла протокол «из воздуха»).
  const transcriptVerdict = material.transcript
    ? assessTranscriptQuality(material.transcript, material.transcriptDurationSeconds)
    : null;
  const transcriptUsable = transcriptVerdict?.ok === true;
  const notesUsable = countMeaningfulWords(material.notes) >= MIN_NOTES_WORDS;

  if (!transcriptUsable && !notesUsable) {
    return NextResponse.json(
      {
        error: INSUFFICIENT_DATA_MESSAGE,
        code: "insufficient_data",
        reason: transcriptVerdict && !transcriptVerdict.ok ? transcriptVerdict.reason : "no_input",
        hint: "Запись слишком короткая или неразборчивая, а заметок мало. Добавьте тезисы в блоки ниже или заполните протокол вручную.",
      },
      { status: 422 }
    );
  }

  // Транскрипт не прошёл порог, но заметок достаточно — генерируем только по
  // заметкам (плохой транскрипт модели не передаётся вообще).
  const useTranscript = transcriptUsable;
  const systemPrompt = selectSoapSystemPrompt(useTranscript);
  const templateContent = template?.content ? maskProfanity(template.content) : undefined;
  const buildMessage = (minimal: boolean) =>
    buildSoapUserMessage({
      transcript: useTranscript ? material.transcript : undefined,
      notes: minimal && useTranscript ? "" : material.notes,
      previousSessionsSummary: minimal ? undefined : material.previousSessionsSummary,
      clientName,
      sessionNumber: material.sessionNumber,
      templateContent: minimal ? undefined : templateContent,
      templateTitle: minimal ? undefined : template?.title ?? undefined,
    });

  // Запускаем генерацию в async-режиме — НЕ ждём результат здесь. Модель та
  // же (Pro), меняется только режим доставки (см. комментарий в начале
  // файла про экономику). yandexGptStartAsyncCompletion возвращает id
  // операции сразу, до завершения генерации.
  //
  // Controlled fallback при отказе модерации: одна повторная «безопасная»
  // попытка с минимальным контекстом (только транскрипт/заметки, без
  // шаблона и резюме прошлых сессий). Если отклонили и её — статус
  // manual_review_required и понятное сообщение, а не молчаливый сбой.
  let operationId: string | null = null;
  let userMessage = buildMessage(false);
  let startError: unknown = null;
  for (const minimal of [false, true]) {
    userMessage = buildMessage(minimal);
    try {
      operationId = await yandexGptStartAsyncCompletion([
        { role: "system", text: systemPrompt },
        { role: "user", text: userMessage },
      ]);
      startError = null;
      break;
    } catch (e) {
      startError = e;
      // Диагностика: статус и тело ответа API (причина 400/403 и т.п.), размеры промпта.
      // Ключи и текст транскрипта не пишем.
      console.error("soap/generate: YandexGPT async start failed", {
        sessionId,
        attempt: minimal ? "minimal" : "full",
        status: e instanceof YandexGptError ? e.status : undefined,
        details: e instanceof YandexGptError ? e.details : String(e),
        systemPromptChars: systemPrompt.length,
        userMessageChars: userMessage.length,
      });
      if (!isModerationRefusal(e)) break;
    }
  }

  if (operationId === null) {
    if (isModerationRefusal(startError)) {
      // Только техническая причина — без текста сессии.
      await supabase.from("soap_generation_jobs").insert({
        session_id: sessionId,
        psychologist_id: user.id,
        operation_id: "none:moderation_rejected",
        status: "manual_review_required",
        error_message: "yandexgpt_moderation_rejected (full and minimal attempts)",
        template_id: template?.id ?? null,
      });
      return NextResponse.json(
        { error: MODERATION_MANUAL_MESSAGE, code: "manual_review_required", reason: "moderation_rejected" },
        { status: 422 }
      );
    }
    const message = startError instanceof YandexGptError ? startError.message : "Не удалось запустить генерацию протокола";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Job хранит только служебное состояние ЭТОГО запроса на генерацию —
  // не результат протокола (тот пишется в soap_notes только когда job
  // готов, см. status/route.ts). template_id job'а нужен, чтобы при
  // сохранении финального результата проставить soap_notes.protocol_template_id
  // тем же значением, что психолог выбрал при запуске.
  const { data: job, error: jobError } = await supabase
    .from("soap_generation_jobs")
    .insert({
      session_id: sessionId,
      psychologist_id: user.id,
      operation_id: operationId,
      status: "pending",
      template_id: template?.id ?? null,
    })
    .select("id")
    .single();

  if (jobError) {
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }

  return NextResponse.json({ jobId: job.id, status: "pending" });
}
