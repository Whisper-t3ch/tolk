import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendViaMessenger, MessengerSendError } from "@/lib/messengers/client";

// GET /api/messages?client_id=...
// История переписки с клиентом (входящие + исходящие), для единого
// чата в карточке клиента. Источник — таблица messages, наполняется
// исходящими из executor.ts (инструменты агента) и входящими из
// /api/webhooks/telegram|vk, а также напрямую отсюда при ручной
// отправке (POST ниже).
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const clientId = request.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Не передан client_id" }, { status: 400 });

  const { data, error } = await supabase
    .from("messages")
    .select("id, channel, direction, kind, text, status, error_message, created_at, sent_at")
    .eq("client_id", clientId)
    .eq("psychologist_id", user.id)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: links } = await supabase
    .from("client_messenger_links")
    .select("platform, external_username, linked_at")
    .eq("client_id", clientId)
    .eq("psychologist_id", user.id);

  return NextResponse.json({ messages: data ?? [], links: links ?? [] });
}

// POST /api/messages
// Body: { client_id: string, text: string, channel: 'telegram' | 'vk' }
// Ручная отправка сообщения психологом из единого чата (не через
// ассистента). Пытается отправить реально, если есть привязка и
// подключённая интеграция — иначе сохраняет как 'pending', как и
// send_message_to_client в executor.ts.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const body = await request.json();
  const { client_id: clientId, text, channel } = body ?? {};
  if (!clientId || !text || !channel) {
    return NextResponse.json({ error: "Нужны client_id, text и channel" }, { status: 400 });
  }

  let status: "pending" | "sent" = "pending";
  let externalMessageId: string | null = null;
  let errorMessage: string | null = null;

  const { data: link } = await supabase
    .from("client_messenger_links")
    .select("external_chat_id")
    .eq("client_id", clientId)
    .eq("psychologist_id", user.id)
    .eq("platform", channel)
    .maybeSingle();

  if (link) {
    const { data: integration } = await supabase
      .from("messenger_integrations")
      .select("bot_token, vk_group_id, status")
      .eq("psychologist_id", user.id)
      .eq("platform", channel)
      .maybeSingle();

    if (integration?.status === "connected" && integration.bot_token) {
      try {
        const result = await sendViaMessenger(
          channel,
          { botToken: integration.bot_token, vkGroupId: integration.vk_group_id },
          link.external_chat_id as string,
          text
        );
        status = "sent";
        externalMessageId = result.externalMessageId;
      } catch (err) {
        errorMessage = err instanceof MessengerSendError ? err.message : "Не удалось отправить сообщение";
      }
    }
  }

  const { data, error } = await supabase
    .from("messages")
    .insert({
      psychologist_id: user.id,
      client_id: clientId,
      channel,
      direction: "outgoing",
      kind: "message",
      text,
      status,
      external_message_id: externalMessageId,
      error_message: errorMessage,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    })
    .select("id, channel, direction, kind, text, status, error_message, created_at, sent_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ message: data });
}
