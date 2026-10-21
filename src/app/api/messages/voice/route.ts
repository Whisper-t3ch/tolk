import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendTelegramVoice, MessengerSendError } from "@/lib/messengers/client";
import { convertToOggOpus } from "@/lib/voiceConvert";

const MAX_BYTES = 6 * 1024 * 1024; // ~3 минуты речи

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// POST /api/messages/voice (multipart: client_id, channel, duration, audio)
// Голосовое сообщение психолога клиенту. Сейчас — только Telegram (VK: голосовые требуют
// отдельной загрузки документа). Аудио на сервере НЕ сохраняется: в чате остаётся запись
// «Голосовое сообщение · 0:23» без звука.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const clientId = String(form.get("client_id") ?? "");
  const channel = String(form.get("channel") ?? "telegram");
  const duration = Number(form.get("duration") ?? 0) || 0;
  const file = form.get("audio");
  if (!clientId || !(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Нужны client_id и запись" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Запись слишком длинная — до 3 минут" }, { status: 413 });
  if (channel !== "telegram") {
    return NextResponse.json({ error: "Голосовые сообщения пока работают только в Telegram" }, { status: 400 });
  }

  const { data: link } = await supabase
    .from("client_messenger_links")
    .select("external_chat_id")
    .eq("client_id", clientId)
    .eq("psychologist_id", user.id)
    .eq("platform", "telegram")
    .maybeSingle();
  if (!link) return NextResponse.json({ error: "Клиент не подключён к Telegram" }, { status: 409 });

  const { data: integration } = await supabase
    .from("messenger_integrations")
    .select("bot_token, status")
    .eq("psychologist_id", user.id)
    .eq("platform", "telegram")
    .maybeSingle();
  if (integration?.status !== "connected" || !integration.bot_token) {
    return NextResponse.json({ error: "Telegram-бот не подключён" }, { status: 409 });
  }

  const raw = Buffer.from(await file.arrayBuffer());
  const ogg = await convertToOggOpus(raw);
  let externalMessageId: string;
  try {
    const result = ogg
      ? await sendTelegramVoice(integration.bot_token, link.external_chat_id as string, ogg, duration)
      : await sendTelegramVoice(integration.bot_token, link.external_chat_id as string, raw, duration, file.name || "voice.webm", file.type || "audio/webm");
    externalMessageId = result.externalMessageId;
  } catch (err) {
    console.error("VOICE_SEND_FAILED", err instanceof Error ? err.message : err, ogg ? "ogg" : "raw");
    return NextResponse.json(
      { error: err instanceof MessengerSendError ? err.message : "Не удалось отправить голосовое сообщение" },
      { status: 502 }
    );
  }

  const { data, error } = await supabase
    .from("messages")
    .insert({
      psychologist_id: user.id,
      client_id: clientId,
      channel: "telegram",
      direction: "outgoing",
      kind: "message",
      text: `🎤 Голосовое сообщение · ${formatDuration(duration)}`,
      status: "sent",
      external_message_id: externalMessageId,
      sent_at: new Date().toISOString(),
    })
    .select("id, channel, direction, kind, text, status, error_message, created_at, sent_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message: data });
}
