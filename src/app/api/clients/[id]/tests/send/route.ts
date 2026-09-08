import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateTestAccessToken } from "@/lib/testQuestionnaires";
import { sendViaMessenger, MessengerSendError } from "@/lib/messengers/client";

// POST /api/clients/[id]/tests/send
// Body: { questionnaire_key: string, title?: string, channel?: 'telegram' | 'vk' }
//
// Создаёт test_results со status="pending" и уникальным access_token,
// затем пытается отправить клиенту ссылку на публичную форму
// /test/[token] тем же способом, что и обычное сообщение (POST
// /api/messages) — реальная отправка через мессенджер, если есть
// привязка и подключённая интеграция, иначе запись остаётся "pending"
// и психолог видит её в чате как неотправленную (тот же паттерн).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  let body: { questionnaire_key?: string; title?: string; channel?: "telegram" | "vk" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const questionnaireKey = body.questionnaire_key?.trim();
  if (!questionnaireKey) {
    return NextResponse.json({ error: "Укажите questionnaire_key" }, { status: 400 });
  }
  const channel = body.channel ?? "telegram";

  // Клиент должен принадлежать текущему психологу.
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (clientError) return NextResponse.json({ error: clientError.message }, { status: 500 });
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 });

  const { data: questionnaire, error: qError } = await supabase
    .from("test_questionnaires")
    .select("test_key, title, schema")
    .eq("test_key", questionnaireKey)
    .maybeSingle();
  if (qError) return NextResponse.json({ error: qError.message }, { status: 500 });
  if (!questionnaire) {
    return NextResponse.json({ error: "Этот тест ещё не переведён в формат интерактивного опросника" }, { status: 404 });
  }

  const accessToken = generateTestAccessToken();
  const schema = questionnaire.schema as { questions: unknown[] };
  const questionsCount = Array.isArray(schema?.questions) ? schema.questions.length : 0;

  const { data: testResult, error: insertError } = await supabase
    .from("test_results")
    .insert({
      client_id: clientId,
      psychologist_id: user.id,
      test_type: questionnaireKey,
      questionnaire_key: questionnaireKey,
      score: 0,
      max_score: 0,
      answers: null,
      interpretation: null,
      status: "pending",
      access_token: accessToken,
    })
    .select("id, access_token")
    .single();
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const testUrl = `${baseUrl}/test/${accessToken}`;
  const title = body.title ?? questionnaire.title;
  const text = `Психолог предлагает пройти тест «${title}» (${questionsCount} вопросов). Пройти можно по ссылке: ${testUrl}`;

  let messageStatus: "pending" | "sent" = "pending";
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
        messageStatus = "sent";
        externalMessageId = result.externalMessageId;
      } catch (err) {
        errorMessage = err instanceof MessengerSendError ? err.message : "Не удалось отправить сообщение";
      }
    }
  }

  const { data: message, error: messageError } = await supabase
    .from("messages")
    .insert({
      psychologist_id: user.id,
      client_id: clientId,
      channel,
      direction: "outgoing",
      kind: "message",
      text,
      status: messageStatus,
      external_message_id: externalMessageId,
      error_message: errorMessage,
      sent_at: messageStatus === "sent" ? new Date().toISOString() : null,
    })
    .select("id, status")
    .single();
  if (messageError) return NextResponse.json({ error: messageError.message }, { status: 500 });

  return NextResponse.json({
    test_result_id: testResult.id,
    test_url: testUrl,
    message_status: message.status,
  });
}
