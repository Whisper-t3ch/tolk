import { createAdminClient } from "@/lib/supabase/admin";
import { telegramBotUrl } from "@/lib/messengers/telegramApi";

// Платформенный Telegram-бот (тот же, что принимает обращения в поддержку):
// шлёт психологам уведомления в привязанный чат. Best-effort: ошибки не бросаются.

export function platformBotUsername(): string {
  return process.env.SUPPORT_TG_BOT_USERNAME || "tolk_supp0rt_bot";
}

export async function sendPlatformTelegram(chatId: string | number, text: string, replyMarkup?: unknown): Promise<boolean> {
  const token = process.env.SUPPORT_TG_BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(telegramBotUrl(token, "sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), reply_markup: replyMarkup }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Отправляет уведомление психологу, если он привязал Telegram. Возвращает true, если доставлено. */
export async function notifyUserTelegram(userId: string, text: string): Promise<boolean> {
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("notification_channels")
      .select("chat_id")
      .eq("user_id", userId)
      .eq("channel", "telegram")
      .maybeSingle();
    if (!data?.chat_id) return false;
    return await sendPlatformTelegram(data.chat_id as string, text);
  } catch {
    return false;
  }
}
