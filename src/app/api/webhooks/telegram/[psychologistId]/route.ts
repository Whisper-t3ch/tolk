import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/webhooks/telegram/[psychologistId]
//
// Telegram шлёт сюда все обновления бота конкретного психолога.
// URL содержит psychologistId, потому что у каждого психолога свой
// бот/токен (настраивается в /settings) — так один webhook-роут
// обслуживает всех психологов без общего секрета в URL.
//
// Подлинность запроса проверяется заголовком X-Telegram-Bot-Api-Secret-Token,
// который Telegram присылает если он был передан в setWebhook (см.
// src/lib/messengers/client.ts::setTelegramWebhook и
// /api/integrations/telegram/route.ts). Значение сверяется с
// messenger_integrations.webhook_secret психолога.
//
// Логика:
//  1. Найти интеграцию психолога по psychologistId, проверить секрет.
//  2. /start <client_id> — привязать telegram chat_id к клиенту
//     (ссылка вида t.me/bot?start=<client_id>, которую психолог
//     отправляет клиенту вручную при заведении карточки).
//  3. Обычное сообщение от уже привязанного chat_id — сохранить как
//     входящее в messages (status='delivered', direction='incoming').
//  4. Сообщение от непривязанного chat_id — отвечаем клиенту, что
//     нужно получить ссылку от психолога (не сохраняем как мусор).
export async function POST(request: NextRequest, { params }: { params: Promise<{ psychologistId: string }> }) {
  const { psychologistId } = await params;
  const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");

  const supabase = createAdminClient();

  const { data: integration, error: integrationError } = await supabase
    .from("messenger_integrations")
    .select("id, bot_token, webhook_secret, status")
    .eq("psychologist_id", psychologistId)
    .eq("platform", "telegram")
    .maybeSingle();

  if (integrationError || !integration) {
    return NextResponse.json({ error: "Интеграция не найдена" }, { status: 404 });
  }
  if (secretHeader !== integration.webhook_secret) {
    return NextResponse.json({ error: "Неверный секрет вебхука" }, { status: 401 });
  }

  const update = await request.json();
  const message = update?.message;
  if (!message) {
    // Другие типы обновлений (edited_message, callback_query и т.д.) пока не обрабатываем.
    return NextResponse.json({ ok: true });
  }

  const chatId = String(message.chat.id);
  const text: string | undefined = message.text;
  const username: string | undefined = message.from?.username;

  // /start <client_id> — привязка чата к клиенту
  if (text?.startsWith("/start")) {
    const clientId = text.split(" ")[1]?.trim();
    if (clientId) {
      const { data: client } = await supabase
        .from("clients")
        .select("id")
        .eq("id", clientId)
        .eq("psychologist_id", psychologistId)
        .maybeSingle();

      if (client) {
        await supabase
          .from("client_messenger_links")
          .upsert(
            {
              client_id: clientId,
              psychologist_id: psychologistId,
              platform: "telegram",
              external_chat_id: chatId,
              external_username: username ?? null,
            },
            { onConflict: "psychologist_id,platform,external_chat_id" }
          );

        await sendTelegramReply(integration.bot_token, chatId,
          "Готово! Теперь психолог сможет отправлять вам сообщения и домашние задания прямо сюда."
        );
        return NextResponse.json({ ok: true });
      }
    }
    await sendTelegramReply(integration.bot_token, chatId,
      "Ссылка недействительна. Попросите психолога прислать новую ссылку для подключения."
    );
    return NextResponse.json({ ok: true });
  }

  // Обычное сообщение — ищем привязку
  const { data: link } = await supabase
    .from("client_messenger_links")
    .select("client_id")
    .eq("psychologist_id", psychologistId)
    .eq("platform", "telegram")
    .eq("external_chat_id", chatId)
    .maybeSingle();

  if (!link) {
    await sendTelegramReply(integration.bot_token, chatId,
      "Похоже, ваш чат ещё не подключён к аккаунту психолога. Попросите у психолога ссылку для подключения."
    );
    return NextResponse.json({ ok: true });
  }

  await supabase.from("messages").insert({
    psychologist_id: psychologistId,
    client_id: link.client_id,
    channel: "telegram",
    direction: "incoming",
    kind: "message",
    text: text ?? "[сообщение без текста — фото/файл/стикер пока не поддерживаются]",
    status: "delivered",
    external_message_id: String(message.message_id),
  });

  return NextResponse.json({ ok: true });
}

async function sendTelegramReply(botToken: string | null, chatId: string, text: string) {
  if (!botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    // Не критично — если ответ клиенту не ушёл, психолог всё равно увидит
    // сообщение или привязку в интерфейсе.
  }
}
