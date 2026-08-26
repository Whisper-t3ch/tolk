import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/clients/[id]/messenger-link?platform=telegram
// Возвращает ссылку-приглашение t.me/<bot>?start=<client_id>, которую
// психолог отправляет клиенту вручную (по почте, лично и т.д.), чтобы
// клиент запустил бота и его чат автоматически привязался
// (обрабатывается в /api/webhooks/telegram/[psychologistId]).
//
// Для VK такой автоматической привязки нет (Callback API сообществ не
// поддерживает deep-link аналог /start с параметром) — там психолог
// привязывает диалог вручную через POST на этот же роут, указав
// external_chat_id (peer_id), который клиент присылает сам после
// первого сообщения в сообщество.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const platform = request.nextUrl.searchParams.get("platform") ?? "telegram";

  const { data: existingLink } = await supabase
    .from("client_messenger_links")
    .select("platform, external_chat_id, external_username, linked_at")
    .eq("client_id", clientId)
    .eq("psychologist_id", user.id)
    .eq("platform", platform)
    .maybeSingle();

  if (existingLink) {
    return NextResponse.json({ linked: true, link: existingLink });
  }

  if (platform === "telegram") {
    const { data: integration } = await supabase
      .from("messenger_integrations")
      .select("bot_username, status")
      .eq("psychologist_id", user.id)
      .eq("platform", "telegram")
      .maybeSingle();

    if (!integration || integration.status !== "connected") {
      return NextResponse.json({ linked: false, error: "Telegram-бот не подключён — настройте интеграцию в разделе «Настройки»" });
    }

    return NextResponse.json({
      linked: false,
      invite_url: `https://t.me/${integration.bot_username}?start=${clientId}`,
    });
  }

  return NextResponse.json({ linked: false, note: "Для VK привязка выполняется вручную — см. POST этого эндпоинта" });
}

// POST /api/clients/[id]/messenger-link
// Body: { platform: 'vk', external_chat_id: string, external_username?: string }
// Ручная привязка (в основном для VK, где нет deep-link аналога /start).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const body = await request.json();
  const { platform, external_chat_id, external_username } = body ?? {};
  if (!platform || !external_chat_id) {
    return NextResponse.json({ error: "Нужны platform и external_chat_id" }, { status: 400 });
  }

  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 });

  const { data, error } = await supabase
    .from("client_messenger_links")
    .upsert(
      {
        client_id: clientId,
        psychologist_id: user.id,
        platform,
        external_chat_id,
        external_username: external_username ?? null,
      },
      { onConflict: "psychologist_id,platform,external_chat_id" }
    )
    .select("platform, external_chat_id, external_username, linked_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ linked: true, link: data });
}

// DELETE /api/clients/[id]/messenger-link?platform=telegram
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const platform = request.nextUrl.searchParams.get("platform");
  if (!platform) return NextResponse.json({ error: "Не передана платформа" }, { status: 400 });

  const { error } = await supabase
    .from("client_messenger_links")
    .delete()
    .eq("client_id", clientId)
    .eq("psychologist_id", user.id)
    .eq("platform", platform);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
