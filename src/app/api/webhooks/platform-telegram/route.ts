import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPlatformTelegram } from "@/lib/notify/platformTelegram";
import { applySupportReply } from "@/lib/support/reply";

// Вебхук платформенного Telegram-бота (@tolk_supp0rt_bot).
// Подлинность — секрет в заголовке X-Telegram-Bot-Api-Secret-Token (задаётся в setWebhook,
// значение — PLATFORM_TG_WEBHOOK_SECRET). Без секрета эндпоинт всегда отвечает 401.
//
// Что обрабатывается:
//  • /start <token>  — привязка Telegram-чата к аккаунту психолога;
//  • /stop           — отвязка;
//  • ответ владельца (чат SUPPORT_TG_CHAT_ID) на сообщение об обращении «#xxxxxxxx» —
//    сохраняется как ответ поддержки и доставляется автору обращения;
//  • остальное — подсказка, как написать в поддержку.

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

interface TgMessage {
  message_id: number;
  text?: string;
  chat: { id: number; type: string };
  from?: { id: number; username?: string; first_name?: string };
  reply_to_message?: { text?: string };
}

export async function POST(request: NextRequest) {
  const secret = process.env.PLATFORM_TG_WEBHOOK_SECRET;
  const header = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || secret.length < 16 || !safeEqual(header, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let update: { message?: TgMessage };
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }
  const msg = update.message;
  if (!msg || !msg.text || msg.chat.type !== "private") return NextResponse.json({ ok: true });

  const chatId = String(msg.chat.id);
  const text = msg.text.trim();
  const db = createAdminClient();
  const adminChat = process.env.SUPPORT_TG_CHAT_ID;

  try {
    // Ответ владельца на обращение
    if (adminChat && chatId === adminChat && msg.reply_to_message?.text) {
      const m = msg.reply_to_message.text.match(/#([0-9a-f]{8})\b/);
      if (m) {
        const r = await applySupportReply(db, { shortId: m[1] }, text);
        await sendPlatformTelegram(
          chatId,
          r.ok
            ? `✓ Ответ на #${m[1]} сохранён${r.telegram ? " и отправлен пользователю в Telegram" : " (в приложении; у пользователя не привязан Telegram)"}.`
            : `Не удалось отправить ответ: ${r.error}`
        );
        return NextResponse.json({ ok: true });
      }
    }

    if (text.startsWith("/start")) {
      const token = text.split(/\s+/)[1];
      if (!token) {
        await sendPlatformTelegram(chatId, "Это бот уведомлений платформы ТОЛК. Чтобы подключить его, откройте в кабинете «Профиль» → «Telegram-уведомления» и нажмите «Подключить».");
        return NextResponse.json({ ok: true });
      }
      const { data: row } = await db.from("notification_link_tokens").select("user_id, expires_at").eq("token", token).maybeSingle();
      if (!row || new Date(row.expires_at as string).getTime() < Date.now()) {
        await sendPlatformTelegram(chatId, "Ссылка устарела. Откройте «Профиль» → «Telegram-уведомления» в кабинете и подключите заново.");
        return NextResponse.json({ ok: true });
      }
      await db.from("notification_channels").upsert(
        { user_id: row.user_id, channel: "telegram", chat_id: chatId, username: msg.from?.username ?? null },
        { onConflict: "user_id,channel" }
      );
      await db.from("notification_link_tokens").delete().eq("token", token);
      await sendPlatformTelegram(chatId, "Готово ✅ Теперь сюда будут приходить уведомления ТОЛК: новые записи клиентов, ответы поддержки. Отключить: /stop");
      return NextResponse.json({ ok: true });
    }

    if (text === "/stop") {
      await db.from("notification_channels").delete().eq("chat_id", chatId).eq("channel", "telegram");
      await sendPlatformTelegram(chatId, "Уведомления отключены. Подключить снова можно в кабинете: «Профиль» → «Telegram-уведомления».");
      return NextResponse.json({ ok: true });
    }

    await sendPlatformTelegram(chatId, "Этот бот присылает уведомления ТОЛК. Чтобы написать в поддержку, откройте в кабинете раздел «Помощь» — ответ придёт сюда и на странице «Помощь».");
  } catch (e) {
    console.error("platform-telegram webhook error:", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true });
}
