import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkYandexGptEnv, yandexGptStartAsyncCompletion, YandexGptError } from "@/lib/yandexgpt";
import {
  buildSoapUserMessage,
  selectSoapSystemPrompt,
} from "@/lib/prompts/soap";

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

  // Транскрипт уже анонимизирован при сохранении (см. /api/webhooks/recording) —
  // читаем как есть, повторная анонимизация не нужна.
  const { data: transcript } = await supabase
    .from("session_transcripts")
    .select("raw_text")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const hasTranscript = Boolean(transcript?.raw_text);

  // Заметки психолога — второй источник для генерации. Их пишут прямо во
  // время звонка (страница /session/[id], автосохранение в
  // soap_notes.s_subjective) или вручную в блоках протокола.
  //
  // Раньше запрос отбивался сразу, если нет транскрипта, а notes в
  // промпт передавались пустой строкой — то есть готовый промпт для
  // работы по заметкам (PROTOCOL_SYSTEM_PROMPT_MANUAL_DEGRADE) никогда
  // не использовался, и вся ИИ-генерация протокола была недоступна, пока
  // не подключены Jitsi и распознавание речи.
  const { data: existingNote } = await supabase
    .from("soap_notes")
    .select("s_subjective, o_objective, a_assessment, p_plan")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const notes = [
    existingNote?.s_subjective,
    existingNote?.o_objective,
    existingNote?.a_assessment,
    existingNote?.p_plan,
  ]
    .map(v => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .join("\n\n");

  if (!hasTranscript && !notes) {
    return NextResponse.json(
      {
        error:
          "Нечего анализировать: нет ни записи сессии, ни заметок. Напишите хотя бы короткие тезисы в блоках ниже — по ним получится собрать протокол.",
      },
      { status: 409 }
    );
  }

  // Порядковый номер сессии клиента (для "Сессия №N" в промпте) и
  // краткий контекст предыдущих сессий — берём готовые гипотезы
  // психолога (a_assessment) из предыдущих протоколов этого клиента,
  // без отдельного дорогого LLM-вызова на резюме.
  const { data: clientSessions } = await supabase
    .from("sessions")
    .select("id, scheduled_at")
    .eq("client_id", clientId)
    .eq("psychologist_id", user.id)
    .order("scheduled_at", { ascending: true });

  const orderedIds = (clientSessions ?? []).map(s => s.id as string);
  const sessionNumber = Math.max(1, orderedIds.indexOf(sessionId) + 1);
  const previousSessionIds = orderedIds.slice(0, Math.max(0, orderedIds.indexOf(sessionId))).slice(-3);

  let previousSessionsSummary: string | undefined;
  if (previousSessionIds.length > 0) {
    const { data: previousNotes } = await supabase
      .from("soap_notes")
      .select("session_id, a_assessment, p_plan")
      .in("session_id", previousSessionIds);
    if (previousNotes && previousNotes.length > 0) {
      previousSessionsSummary = previousNotes
        .map(n => {
          const gist = [n.a_assessment, n.p_plan].filter(Boolean).join(" ");
          return gist ? `— ${gist}` : null;
        })
        .filter(Boolean)
        .join("\n");
    }
  }

  const systemPrompt = selectSoapSystemPrompt(hasTranscript);
  const userMessage = buildSoapUserMessage({
    transcript: hasTranscript ? (transcript!.raw_text as string) : undefined,
    notes,
    previousSessionsSummary,
    clientName,
    sessionNumber,
    templateContent: template?.content,
    templateTitle: template?.title ?? undefined,
  });

  // Запускаем генерацию в async-режиме — НЕ ждём результат здесь. Модель та
  // же (Pro), меняется только режим доставки (см. комментарий в начале
  // файла про экономику). yandexGptStartAsyncCompletion возвращает id
  // операции сразу, до завершения генерации.
  let operationId: string;
  try {
    operationId = await yandexGptStartAsyncCompletion([
      { role: "system", text: systemPrompt },
      { role: "user", text: userMessage },
    ]);
  } catch (e) {
    const message = e instanceof YandexGptError ? e.message : "Не удалось запустить генерацию протокола";
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
