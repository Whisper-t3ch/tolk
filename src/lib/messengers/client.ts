// ============================================================
// Отправка сообщений через Telegram Bot API и VK Bot API.
//
// Токены хранятся не в env (они разные у каждого психолога), а в
// таблице messenger_integrations (см. migration_005_integrations.sql).
// Вызывающий код (executor.ts) сам достаёт нужную интеграцию из БД
// и передаёт токен сюда — этот модуль не знает про Supabase.
// ============================================================

export class MessengerSendError extends Error {
  constructor(message: string, public platform: "telegram" | "vk") {
    super(message);
    this.name = "MessengerSendError";
  }
}

interface SendResult {
  externalMessageId: string;
}

// ------------------------------------------------------------
// Telegram
// ------------------------------------------------------------

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<SendResult> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new MessengerSendError(
      data?.description ?? `Telegram API вернул ошибку (HTTP ${res.status})`,
      "telegram"
    );
  }
  return { externalMessageId: String(data.result.message_id) };
}

export async function setTelegramWebhook(botToken: string, webhookUrl: string, secretToken: string) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secretToken,
      allowed_updates: ["message"],
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new MessengerSendError(
      data?.description ?? `Не удалось установить webhook (HTTP ${res.status})`,
      "telegram"
    );
  }
  return data.result;
}

export async function getTelegramBotInfo(botToken: string): Promise<{ username: string; id: number }> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new MessengerSendError(
      data?.description ?? "Неверный токен бота — Telegram не смог его подтвердить",
      "telegram"
    );
  }
  return { username: data.result.username, id: data.result.id };
}

// ------------------------------------------------------------
// VK (Bot API сообщества)
// ------------------------------------------------------------

const VK_API_VERSION = "5.199";

export async function sendVkMessage(
  groupAccessToken: string,
  peerId: string,
  text: string
): Promise<SendResult> {
  const params = new URLSearchParams({
    access_token: groupAccessToken,
    v: VK_API_VERSION,
    peer_id: peerId,
    message: text,
    random_id: String(Math.floor(Math.random() * 2_147_483_647)),
  });

  const res = await fetch(`https://api.vk.com/method/messages.send?${params.toString()}`, {
    method: "POST",
  });
  const data = await res.json();
  if (data.error) {
    throw new MessengerSendError(
      data.error.error_msg ?? `VK API вернул ошибку ${data.error.error_code}`,
      "vk"
    );
  }
  return { externalMessageId: String(data.response) };
}

export async function getVkGroupInfo(groupAccessToken: string): Promise<{ name: string; id: number }> {
  const params = new URLSearchParams({
    access_token: groupAccessToken,
    v: VK_API_VERSION,
  });
  const res = await fetch(`https://api.vk.com/method/groups.getById?${params.toString()}`);
  const data = await res.json();
  if (data.error) {
    throw new MessengerSendError(
      data.error.error_msg ?? "Неверный токен сообщества — VK не смог его подтвердить",
      "vk"
    );
  }
  const group = data.response?.groups?.[0] ?? data.response?.[0];
  if (!group) throw new MessengerSendError("VK вернул пустой ответ при проверке токена", "vk");
  return { name: group.name, id: group.id };
}

// ------------------------------------------------------------
// Единая точка отправки — используется из executor.ts
// ------------------------------------------------------------

export async function sendViaMessenger(
  platform: "telegram" | "vk",
  credentials: { botToken?: string | null; vkGroupId?: string | null },
  externalChatId: string,
  text: string
): Promise<SendResult> {
  if (platform === "telegram") {
    if (!credentials.botToken) throw new MessengerSendError("Не задан токен Telegram-бота", "telegram");
    return sendTelegramMessage(credentials.botToken, externalChatId, text);
  }
  if (platform === "vk") {
    if (!credentials.botToken) throw new MessengerSendError("Не задан токен сообщества VK", "vk");
    return sendVkMessage(credentials.botToken, externalChatId, text);
  }
  throw new MessengerSendError(`Неизвестная платформа: ${platform}`, platform);
}
