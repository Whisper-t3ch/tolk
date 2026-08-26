import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getTelegramBotInfo,
  setTelegramWebhook,
  getVkGroupInfo,
  MessengerSendError,
} from "@/lib/messengers/client";

// GET /api/integrations
// Список подключённых интеграций текущего психолога (без секретов).
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { data, error } = await supabase
    .from("messenger_integrations")
    .select("id, platform, bot_username, status, last_error, connected_at, webhook_secret")
    .eq("psychologist_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ integrations: data ?? [] });
}

// POST /api/integrations
// Body: { platform: 'telegram', bot_token: string }
//     | { platform: 'vk', bot_token: string (group access token), vk_group_id: string, confirmation_code: string }
//
// Проверяет токен через API платформы, сохраняет интеграцию,
// для Telegram сразу регистрирует webhook (VK настраивается вручную
// психологом в настройках Callback API сообщества — см. footnote в ответе).
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const body = await request.json();
  const platform = body?.platform;

  if (platform === "telegram") {
    const botToken = body?.bot_token?.trim();
    if (!botToken) return NextResponse.json({ error: "Не передан токен бота" }, { status: 400 });

    let botInfo;
    try {
      botInfo = await getTelegramBotInfo(botToken);
    } catch (err) {
      const message = err instanceof MessengerSendError ? err.message : "Не удалось проверить токен";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { data: existing } = await supabase
      .from("messenger_integrations")
      .select("id, webhook_secret")
      .eq("psychologist_id", user.id)
      .eq("platform", "telegram")
      .maybeSingle();

    const { data: saved, error: saveError } = await supabase
      .from("messenger_integrations")
      .upsert(
        {
          id: existing?.id,
          psychologist_id: user.id,
          platform: "telegram",
          bot_token: botToken,
          bot_username: botInfo.username,
          status: "connected",
          connected_at: new Date().toISOString(),
          last_error: null,
        },
        { onConflict: "psychologist_id,platform" }
      )
      .select("id, webhook_secret")
      .single();
    if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      return NextResponse.json({
        integration: { platform: "telegram", bot_username: botInfo.username, status: "connected" },
        warning: "NEXT_PUBLIC_APP_URL не задан — webhook не зарегистрирован автоматически. Задайте переменную окружения и переподключите бота.",
      });
    }

    try {
      await setTelegramWebhook(
        botToken,
        `${appUrl}/api/webhooks/telegram/${user.id}`,
        saved.webhook_secret
      );
    } catch (err) {
      const message = err instanceof MessengerSendError ? err.message : "Не удалось зарегистрировать webhook";
      await supabase
        .from("messenger_integrations")
        .update({ status: "error", last_error: message })
        .eq("id", saved.id);
      return NextResponse.json({ error: `Токен верный, но не удалось настроить webhook: ${message}` }, { status: 500 });
    }

    return NextResponse.json({
      integration: { platform: "telegram", bot_username: botInfo.username, status: "connected" },
    });
  }

  if (platform === "vk") {
    const groupAccessToken = body?.bot_token?.trim();
    const vkGroupId = body?.vk_group_id?.trim();
    const confirmationCode = body?.confirmation_code?.trim();
    if (!groupAccessToken || !vkGroupId || !confirmationCode) {
      return NextResponse.json(
        { error: "Нужны group_access_token, vk_group_id и confirmation_code (из настроек Callback API сообщества)" },
        { status: 400 }
      );
    }

    let groupInfo;
    try {
      groupInfo = await getVkGroupInfo(groupAccessToken);
    } catch (err) {
      const message = err instanceof MessengerSendError ? err.message : "Не удалось проверить токен сообщества";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { data: existing } = await supabase
      .from("messenger_integrations")
      .select("id, webhook_secret")
      .eq("psychologist_id", user.id)
      .eq("platform", "vk")
      .maybeSingle();

    const { data: saved, error: saveError } = await supabase
      .from("messenger_integrations")
      .upsert(
        {
          id: existing?.id,
          psychologist_id: user.id,
          platform: "vk",
          bot_token: groupAccessToken,
          vk_group_id: vkGroupId,
          confirmation_code: confirmationCode,
          bot_username: groupInfo.name,
          status: "connected",
          connected_at: new Date().toISOString(),
          last_error: null,
        },
        { onConflict: "psychologist_id,platform" }
      )
      .select("webhook_secret")
      .single();
    if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    return NextResponse.json({
      integration: { platform: "vk", bot_username: groupInfo.name, status: "connected" },
      setup_instructions: appUrl
        ? {
            callback_url: `${appUrl}/api/webhooks/vk/${user.id}`,
            secret_key: saved.webhook_secret,
            note: "Вставьте эти значения в настройках сообщества → Управление → Работа с API → Callback API",
          }
        : { note: "NEXT_PUBLIC_APP_URL не задан — не можем показать готовый Callback URL." },
    });
  }

  return NextResponse.json({ error: "Неизвестная платформа" }, { status: 400 });
}

// DELETE /api/integrations?platform=telegram
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const platform = request.nextUrl.searchParams.get("platform");
  if (!platform) return NextResponse.json({ error: "Не передана платформа" }, { status: 400 });

  const { error } = await supabase
    .from("messenger_integrations")
    .delete()
    .eq("psychologist_id", user.id)
    .eq("platform", platform);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
