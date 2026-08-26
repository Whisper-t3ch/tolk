import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/webhooks/vk/[psychologistId]
//
// VK Callback API. Особенность VK: при подключении Callback API в
// настройках сообщества VK шлёт type: 'confirmation' и ждёт в ответ
// голый текст confirmation_code (не JSON!) — этот код генерируется
// самим VK и отображается один раз в настройках сообщества;
// психолог вводит его при подключении интеграции (см.
// /api/integrations/vk/route.ts, поле confirmation_code).
//
// Подлинность обычных событий (type: 'message_new') проверяется
// полем secret в теле запроса — секрет задаётся в настройках
// Callback API сообщества и должен совпадать с
// messenger_integrations.webhook_secret.
export async function POST(request: NextRequest, { params }: { params: Promise<{ psychologistId: string }> }) {
  const { psychologistId } = await params;
  const body = await request.json();

  const supabase = createAdminClient();

  const { data: integration } = await supabase
    .from("messenger_integrations")
    .select("id, bot_token, webhook_secret, confirmation_code, status")
    .eq("psychologist_id", psychologistId)
    .eq("platform", "vk")
    .maybeSingle();

  if (!integration) {
    return new NextResponse("integration not found", { status: 404 });
  }

  if (body.type === "confirmation") {
    // Отвечаем голым текстом, как требует VK — НЕ JSON.
    return new NextResponse(integration.confirmation_code ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (body.secret !== integration.webhook_secret) {
    return new NextResponse("invalid secret", { status: 401 });
  }

  if (body.type === "message_new") {
    const message = body.object?.message;
    const peerId = String(message?.peer_id ?? message?.from_id);
    const text: string = message?.text ?? "";

    const { data: link } = await supabase
      .from("client_messenger_links")
      .select("client_id")
      .eq("psychologist_id", psychologistId)
      .eq("platform", "vk")
      .eq("external_chat_id", peerId)
      .maybeSingle();

    if (link) {
      await supabase.from("messages").insert({
        psychologist_id: psychologistId,
        client_id: link.client_id,
        channel: "vk",
        direction: "incoming",
        kind: "message",
        text: text || "[сообщение без текста — вложение пока не поддерживается]",
        status: "delivered",
        external_message_id: String(message?.id ?? message?.conversation_message_id ?? ""),
      });
    }
    // Непривязанные сообщения молча игнорируем — у VK сообществ нет
    // аналога /start с параметром, привязка делается только вручную
    // психологом в интерфейсе (клиент присылает системе номер/имя,
    // психолог выбирает диалог из списка непривязанных).
  }

  // VK требует ответ "ok" (текстом) в течение нескольких секунд,
  // иначе повторит отправку события.
  return new NextResponse("ok", { status: 200, headers: { "Content-Type": "text/plain" } });
}
