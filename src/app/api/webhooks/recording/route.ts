import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { transcribeAudio, AsrError } from "@/lib/asr";
import { yandexGptEmbed } from "@/lib/yandexgpt";
import { anonymizeTranscript } from "@/lib/anonymize";

// POST /api/webhooks/recording
// Body: { session_id: string, recording_url: string }
//
// Вызывается скриптом на ВМ (Jibri finalize_recording hook) после того,
// как запись сессии готова и загружена в доступное по URL хранилище
// (см. outputs/backend/deploy_jitsi_gigaam.md — точный способ хранения
// записей — presigned Supabase Storage URL или внутренний адрес ВМ —
// уточняется при деплое). Это системный webhook от нашей же
// инфраструктуры, не от внешнего провайдера — поэтому авторизация через
// общий секрет в заголовке (RECORDING_WEBHOOK_SECRET), а не per-психолог
// секрет, как у Telegram/VK.
//
// Пайплайн: пометить sessions.recording_status='processing' →
// отправить запись в GigaAM (lib/asr.ts) → анонимизировать текст
// (lib/anonymize.ts, имя клиента остаётся) → сохранить в
// session_transcripts (source='jitsi_gigaam') ТОЛЬКО анонимизированную
// версию → посчитать embedding для RAG уже из неё → recording_status='ready'.
//
// Сырой текст от GigaAM живёт только в памяти этой функции и никуда не
// сохраняется — раньше raw_text хранился как есть, а анонимизация
// применялась точечно перед каждым LLM-запросом (executor.ts,
// periodSummary.ts). Теперь анонимизация происходит один раз здесь, до
// первой записи в БД, а вызывающий код читает уже чистый текст напрямую
// без повторной анонимизации (двойное применение избыточно и не нужно).
export async function POST(request: NextRequest) {
  const secret = process.env.RECORDING_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "RECORDING_WEBHOOK_SECRET не настроен на сервере" }, { status: 503 });
  }
  const providedSecret = request.headers.get("x-recording-webhook-secret");
  if (providedSecret !== secret) {
    return NextResponse.json({ error: "Неверный секрет вебхука" }, { status: 401 });
  }

  let body: { session_id?: string; recording_url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const sessionId = body.session_id;
  const recordingUrl = body.recording_url;
  if (!sessionId || !recordingUrl) {
    return NextResponse.json({ error: "Нужны session_id и recording_url" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, psychologist_id, clients ( name )")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }
  const clientRel = Array.isArray(session.clients) ? session.clients[0] : session.clients;
  const clientName = (clientRel as { name?: string } | null)?.name ?? "";

  await supabase
    .from("sessions")
    .update({ recording_status: "processing", recording_url: recordingUrl })
    .eq("id", sessionId);

  let transcript;
  try {
    transcript = await transcribeAudio(recordingUrl);
  } catch (e) {
    const message = e instanceof AsrError ? e.message : "Не удалось расшифровать запись";
    await supabase
      .from("sessions")
      .update({ recording_status: "failed", transcript_error: message })
      .eq("id", sessionId);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Анонимизируем СРАЗУ, до первой записи в БД — сырой текст от GigaAM
  // дальше этой переменной не переживает. Имя клиента (clientName)
  // сохраняется как есть, персональные данные третьих лиц заменяются на
  // роли/обобщения (см. lib/anonymize.ts). При сбое анонимизации
  // anonymizeTranscript возвращает исходный текст без изменений — в этом
  // редком случае лучше сохранить неанонимизированный транскрипт, чем
  // потерять запись сессии целиком.
  const anonymizedText = await anonymizeTranscript(transcript.text, clientName);

  // Эмбеддинг для RAG (search_client_history) строим уже из
  // анонимизированного текста — если он не посчитается, транскрипт
  // всё равно полезен для SOAP/суммаризации, поэтому не прерываем
  // пайплайн из-за сбоя одного лишь embedding-вызова.
  let embedding: number[] | null = null;
  try {
    embedding = await yandexGptEmbed(anonymizedText, "doc");
  } catch {
    embedding = null;
  }

  const { error: insertError } = await supabase.from("session_transcripts").insert({
    session_id: sessionId,
    raw_text: anonymizedText,
    source: "jitsi_gigaam",
    duration_seconds: transcript.durationSeconds,
    embedding,
  });
  if (insertError) {
    await supabase
      .from("sessions")
      .update({ recording_status: "failed", transcript_error: insertError.message })
      .eq("id", sessionId);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  await supabase
    .from("sessions")
    .update({ recording_status: "ready", transcript_error: null })
    .eq("id", sessionId);

  return NextResponse.json({ ok: true });
}
