import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleClientTelegramUpdate } from "@/lib/messengers/telegramInbound";

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
// Логика — в lib/messengers/telegramInbound.ts (общая с long polling, т.к. Telegram может не достучаться до домена):
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
  await handleClientTelegramUpdate(supabase, psychologistId, { bot_token: integration.bot_token }, update);
  return NextResponse.json({ ok: true });
}
