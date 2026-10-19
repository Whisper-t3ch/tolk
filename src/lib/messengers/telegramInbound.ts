import type { SupabaseClient } from "@supabase/supabase-js";
import { TELEGRAM_API_BASE, telegramBotUrl } from "@/lib/messengers/telegramApi";

// Обработка входящих обновлений бота психолога (общая для вебхука и long polling).
//
//  1. /start <client_id> — привязать telegram chat_id к клиенту (ссылка t.me/bot?start=<client_id>).
//  2. Обычное сообщение от привязанного chat_id — сохранить как входящее в messages.
//  3. Сообщение от непривязанного chat_id — подсказка, как подключиться.
//  Дополнительно: при привязке и раз в 7 дней при сообщении подтягиваем аватарку клиента из Telegram.

export interface BotIntegration {
  bot_token: string | null;
}

interface TgUpdate {
  update_id?: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number | string; type?: string };
    from?: { id?: number; username?: string };
  };
}

const AVATAR_RECHECK_MS = 7 * 24 * 3600 * 1000;
const AVATAR_MAX_BYTES = 80_000;

/** Тянет маленькую аватарку пользователя Telegram и кладёт в clients.avatar_data. Best-effort. */
export async function syncTelegramAvatar(
  db: SupabaseClient,
  botToken: string,
  clientId: string,
  telegramUserId: string | number,
  force = false
): Promise<void> {
  try {
    if (!force) {
      const { data: c } = await db.from("clients").select("avatar_checked_at").eq("id", clientId).maybeSingle();
      const last = c?.avatar_checked_at ? new Date(c.avatar_checked_at as string).getTime() : 0;
      if (Date.now() - last < AVATAR_RECHECK_MS) return;
    }
    // Фиксируем попытку сразу — даже если фото нет или Telegram не ответил.
    await db.from("clients").update({ avatar_checked_at: new Date().toISOString() }).eq("id", clientId);

    const photosRes = await fetch(telegramBotUrl(botToken, "getUserProfilePhotos"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: Number(telegramUserId), limit: 1 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!photosRes.ok) return;
    const photos = (await photosRes.json()) as { result?: { photos?: { file_id: string; width: number }[][] } };
    const sizes = photos.result?.photos?.[0];
    if (!sizes || sizes.length === 0) return;
    // Размеры идут по возрастанию — берём самый маленький (~160px): достаточно для кружка 40–56px.
    const pick = [...sizes].sort((a, b) => a.width - b.width)[0];

    const fileRes = await fetch(telegramBotUrl(botToken, "getFile"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: pick.file_id }),
      signal: AbortSignal.timeout(8000),
    });
    if (!fileRes.ok) return;
    const filePath = ((await fileRes.json()) as { result?: { file_path?: string } }).result?.file_path;
    if (!filePath) return;

    const imgRes = await fetch(`${TELEGRAM_API_BASE}/file/bot${botToken}/${filePath}`, { signal: AbortSignal.timeout(10_000) });
    if (!imgRes.ok) return;
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length === 0 || buf.length > AVATAR_MAX_BYTES) return;
    await db.from("clients").update({ avatar_data: `data:image/jpeg;base64,${buf.toString("base64")}` }).eq("id", clientId);
  } catch {
    // аватарка — украшение, не критично
  }
}

async function sendTelegramReply(botToken: string | null, chatId: string, text: string) {
  if (!botToken) return;
  try {
    await fetch(telegramBotUrl(botToken, "sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Не критично — психолог всё равно увидит сообщение или привязку в интерфейсе.
  }
}

export async function handleClientTelegramUpdate(
  db: SupabaseClient,
  psychologistId: string,
  integration: BotIntegration,
  update: TgUpdate
): Promise<void> {
  const message = update?.message;
  if (!message) return; // edited_message, callback_query и т.д. пока не обрабатываем

  const chatId = String(message.chat.id);
  const text: string | undefined = message.text;
  const username: string | undefined = message.from?.username;
  // В личном чате chat.id совпадает с user id — по нему берём фото профиля.
  const userId = message.from?.id ?? message.chat.id;

  if (text?.startsWith("/start")) {
    const clientId = text.split(" ")[1]?.trim();
    if (clientId) {
      const { data: client } = await db
        .from("clients")
        .select("id")
        .eq("id", clientId)
        .eq("psychologist_id", psychologistId)
        .maybeSingle();

      if (client) {
        await db.from("client_messenger_links").upsert(
          {
            client_id: clientId,
            psychologist_id: psychologistId,
            platform: "telegram",
            external_chat_id: chatId,
            external_username: username ?? null,
          },
          { onConflict: "psychologist_id,platform,external_chat_id" }
        );
        await sendTelegramReply(integration.bot_token, chatId, "Готово! Теперь психолог сможет отправлять вам сообщения и домашние задания прямо сюда.");
        if (integration.bot_token) await syncTelegramAvatar(db, integration.bot_token, clientId, userId, true);
        return;
      }
    }
    await sendTelegramReply(integration.bot_token, chatId, "Ссылка недействительна. Попросите психолога прислать новую ссылку для подключения.");
    return;
  }

  const { data: link } = await db
    .from("client_messenger_links")
    .select("client_id")
    .eq("psychologist_id", psychologistId)
    .eq("platform", "telegram")
    .eq("external_chat_id", chatId)
    .maybeSingle();

  if (!link) {
    await sendTelegramReply(integration.bot_token, chatId, "Похоже, ваш чат ещё не подключён к аккаунту психолога. Попросите у психолога ссылку для подключения.");
    return;
  }

  await db.from("messages").insert({
    psychologist_id: psychologistId,
    client_id: link.client_id,
    channel: "telegram",
    direction: "incoming",
    kind: "message",
    text: text ?? "[сообщение без текста — фото/файл/стикер пока не поддерживаются]",
    status: "delivered",
    external_message_id: String(message.message_id),
  });

  if (integration.bot_token) await syncTelegramAvatar(db, integration.bot_token, link.client_id as string, userId);
}
