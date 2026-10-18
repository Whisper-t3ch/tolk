import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createHttpAsrAdapter } from "@/lib/recording/asrAdapter";
import { AsrError } from "@/lib/asr";

const MAX_BYTES = 6 * 1024 * 1024; // ~3 минуты речи в webm/opus

// POST /api/voice/transcribe (multipart: audio) — голосовой ввод психолога
// (поле ассистента, рефлексия). Распознаём СВОИМ GigaAM на нашей ВМ:
// аудио не уходит во внешние сервисы (в отличие от Web Speech API браузера,
// который шлёт звук на серверы Google) и нигде не сохраняется — только текст.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const serviceUrl = process.env.ASR_SERVICE_URL;
  if (!serviceUrl) {
    return NextResponse.json({ error: "Голосовой ввод временно недоступен" }, { status: 503 });
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("audio");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  if (!file || file.size === 0) return NextResponse.json({ error: "Пустая запись" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Запись слишком длинная — до 3 минут" }, { status: 413 });

  try {
    const adapter = createHttpAsrAdapter(serviceUrl, { authToken: process.env.ASR_SERVICE_TOKEN });
    const result = await adapter.transcribeTrack(Buffer.from(await file.arrayBuffer()), "psychologist");
    return NextResponse.json({ text: result.text });
  } catch (e) {
    console.error("VOICE_TRANSCRIBE_FAILED", e instanceof AsrError ? e.message : e);
    return NextResponse.json({ error: "Не удалось распознать речь. Попробуйте ещё раз." }, { status: 502 });
  }
}
