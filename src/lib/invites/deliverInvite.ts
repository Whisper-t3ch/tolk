// Доставка ссылки-приглашения клиенту в его чат (Telegram/VK) — тот же механизм привязки
// (client_messenger_links) и интеграции (messenger_integrations), что у POST /api/messages
// и инструментов ассистента. Если у клиента нет подключённого чата, ничего не сохраняется
// и не «зависает» в pending: психолог получает ссылку в интерфейсе и копирует её сам.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendViaMessenger, MessengerSendError } from "@/lib/messengers/client";

export type InviteDelivery =
  | { status: "sent"; channel: "telegram" | "vk" }
  | { status: "already_sent"; channel: string }
  | { status: "no_channel" }
  | { status: "failed"; error: string };

const PLATFORMS: Array<"telegram" | "vk"> = ["telegram", "vk"];

export async function deliverInviteToClientChat(
  supabase: SupabaseClient,
  params: {
    psychologistId: string;
    clientId: string;
    sessionId: string;
    text: string;
    /** Не отправлять повторно, если приглашение по этой сессии уже уходило за последние N минут (0 = всегда отправлять). */
    dedupeMinutes?: number;
  }
): Promise<InviteDelivery> {
  const { psychologistId, clientId, sessionId, text } = params;
  const dedupeMinutes = params.dedupeMinutes ?? 0;

  if (dedupeMinutes > 0) {
    const since = new Date(Date.now() - dedupeMinutes * 60_000).toISOString();
    const { data: recent } = await supabase
      .from("messages")
      .select("channel")
      .eq("psychologist_id", psychologistId)
      .eq("client_id", clientId)
      .eq("related_session_id", sessionId)
      .eq("kind", "session_invite")
      .eq("status", "sent")
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();
    if (recent) return { status: "already_sent", channel: String(recent.channel) };
  }

  let lastError: string | null = null;
  for (const platform of PLATFORMS) {
    const { data: link } = await supabase
      .from("client_messenger_links")
      .select("external_chat_id")
      .eq("client_id", clientId)
      .eq("psychologist_id", psychologistId)
      .eq("platform", platform)
      .maybeSingle();
    if (!link) continue;

    const { data: integration } = await supabase
      .from("messenger_integrations")
      .select("bot_token, vk_group_id, status")
      .eq("psychologist_id", psychologistId)
      .eq("platform", platform)
      .maybeSingle();
    if (!integration || integration.status !== "connected" || !integration.bot_token) continue;

    try {
      const result = await sendViaMessenger(
        platform,
        { botToken: integration.bot_token as string, vkGroupId: integration.vk_group_id as string | null },
        link.external_chat_id as string,
        text
      );
      await supabase.from("messages").insert({
        psychologist_id: psychologistId,
        client_id: clientId,
        channel: platform,
        direction: "outgoing",
        kind: "session_invite",
        text,
        status: "sent",
        external_message_id: result.externalMessageId,
        related_session_id: sessionId,
        sent_at: new Date().toISOString(),
      });
      return { status: "sent", channel: platform };
    } catch (err) {
      lastError = err instanceof MessengerSendError ? err.message : "Не удалось отправить сообщение";
    }
  }

  return lastError ? { status: "failed", error: lastError } : { status: "no_channel" };
}
