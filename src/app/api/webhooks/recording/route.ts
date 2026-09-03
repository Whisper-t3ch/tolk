import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { transcribeAudio, AsrError } from "@/lib/asr";
import { yandexGptEmbed } from "@/lib/yandexgpt";

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
// отправить запись в GigaAM (lib/asr.ts) → сохранить raw_text в
// session_transcripts (source='jitsi_gigaam') → посчитать embedding для
// RAG → recording_status='ready'. Транскрипт сохраняется СЫРЫМ (без
// анонимизации) — анонимизация происходит на лету при чтении для LLM
// (см. lib/anonymize.ts), это уже устоявшийся паттерн в проекте.
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
    .select("id, psychologist_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }

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

  // Эмбеддинг для RAG (search_client_history) — если он не посчитается,
  // транскрипт всё равно полезен для SOAP/суммаризации, поэтому не
  // прерываем пайплайн из-за сбоя одного лишь embedding-вызова.
  let embedding: number[] | null = null;
  try {
    embedding = await yandexGptEmbed(transcript.text, "doc");
  } catch {
    embedding = null;
  }

  const { error: insertError } = await supabase.from("session_transcripts").insert({
    session_id: sessionId,
    raw_text: transcript.text,
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
