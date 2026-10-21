import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildJitsiRoomName } from "@/lib/jitsi";
import { pastSessionMoment } from "@/lib/pastSession";
import { checkAudioFile, pickUploadAdapter, processUploadedAudio, releaseAudioSlot, tryAcquireAudioSlot } from "@/lib/recording/uploadedAudio";

// POST /api/clients/[id]/transcript-audio — multipart: file (аудио), date? (YYYY-MM-DD)
// Создаёт «прошедшую» сессию клиента и в фоне расшифровывает аудио (GigaAM) → обезличивание → история клиента.
// Ответ 202 сразу; результат — recording_status сессии (processing → ready | failed).
export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
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

  const { data: client, error: clientError } = await supabase
    .from("clients").select("id, name").eq("id", clientId).eq("psychologist_id", user.id).maybeSingle();
  if (clientError) return NextResponse.json({ error: clientError.message }, { status: 500 });
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 });

  const dateRaw = form.get("date");
  const moment = await pastSessionMoment(supabase, user.id, typeof dateRaw === "string" && dateRaw ? dateRaw : null);
  if (!moment.ok) return NextResponse.json({ error: moment.error }, { status: 400 });

  if (!tryAcquireAudioSlot()) {
    return NextResponse.json({ error: "Сейчас обрабатываются другие записи. Повторите через несколько минут." }, { status: 429 });
  }
  let audio: Buffer;
  const sessionId = crypto.randomUUID();
  try {
    audio = Buffer.from(await checked.file.arrayBuffer());
    const { error: sessionError } = await supabase.from("sessions").insert({
      id: sessionId,
      psychologist_id: user.id,
      client_id: clientId,
      scheduled_at: moment.scheduledAt,
      status: "completed",
      jitsi_room_name: buildJitsiRoomName(sessionId),
      recording_status: "processing",
    });
    if (sessionError) {
      releaseAudioSlot();
      return NextResponse.json({ error: sessionError.message }, { status: 500 });
    }
  } catch {
    releaseAudioSlot();
    return NextResponse.json({ error: "Не удалось принять файл" }, { status: 500 });
  }

  after(async () => {
    try {
      await processUploadedAudio({ supabase, sessionId, clientName: (client.name as string) ?? "", audio, adapter });
    } finally {
      releaseAudioSlot();
    }
  });
  return NextResponse.json({ ok: true, processing: true, sessionId }, { status: 202 });
}
