import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAutoSessionSummary } from "@/lib/autoSessionSummary";
import { checkAudioFile, pickUploadAdapter, processUploadedAudio, releaseAudioSlot, tryAcquireAudioSlot } from "@/lib/recording/uploadedAudio";

// POST /api/sessions/[id]/transcript-audio — multipart: file (аудио). Для существующей сессии (запись вне платформы).
export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать файл. Возможно, он слишком большой." }, { status: 400 });
  }
  const checked = checkAudioFile(form);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: checked.status });

  const adapter = pickUploadAdapter(checked.ext);
  if (!adapter) return NextResponse.json({ error: "Расшифровка аудио пока не подключена на сервере. Загрузите текстовую расшифровку.", code: "asr_unavailable" }, { status: 503 });

  const { data: session, error } = await supabase
    .from("sessions").select("id, recording_status, clients ( name )").eq("id", sessionId).eq("psychologist_id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!session) return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  if (session.recording_status === "processing") {
    return NextResponse.json({ error: "Для этой сессии уже идёт расшифровка" }, { status: 409 });
  }
  const rel = Array.isArray(session.clients) ? session.clients[0] : session.clients;
  const clientName = (rel as { name?: string } | null)?.name ?? "";

  if (!tryAcquireAudioSlot()) {
    return NextResponse.json({ error: "Сейчас обрабатываются другие записи. Повторите через несколько минут." }, { status: 429 });
  }
  let audio: Buffer;
  try {
    audio = Buffer.from(await checked.file.arrayBuffer());
    await supabase.from("sessions").update({ recording_status: "processing", transcript_error: null }).eq("id", sessionId);
  } catch {
    releaseAudioSlot();
    return NextResponse.json({ error: "Не удалось принять файл" }, { status: 500 });
  }
  after(async () => {
    try {
      await processUploadedAudio({ supabase, sessionId, clientName, audio, adapter, onReady: async () => { await runAutoSessionSummary(createAdminClient(), sessionId); } });
    } finally {
      releaseAudioSlot();
    }
  });
  return NextResponse.json({ ok: true, processing: true, sessionId }, { status: 202 });
}
