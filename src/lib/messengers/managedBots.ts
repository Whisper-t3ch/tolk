import type { SupabaseClient } from "@supabase/supabase-js";
import { telegramBotUrl } from "@/lib/messengers/telegramApi";
import { getTelegramBotInfo } from "@/lib/messengers/client";
import { platformBotUsername, notifyUserTelegram } from "@/lib/notify/platformTelegram";

// Telegram Managed Bots: платформенный бот (@tolk_supp0rt_bot, can_manage_bots) создаёт ботов психологов.
// Поток: POST /api/integrations/telegram/managed создаёт запрос и ссылку t.me/newbot/<менеджер>/<username>;
// психолог подтверждает создание в Telegram; менеджер получает update `managed_bot` (поллер платформенного
// бота), забирает токен (getManagedBotToken) и подключает бота как обычную интеграцию.

export interface TgUserLite { id: number; username?: string; first_name?: string }
export interface ManagedBotUpdate { user?: TgUserLite; bot?: TgUserLite; bot_user?: TgUserLite }

const REQUEST_TTL_MS = 2 * 60 * 60 * 1000;

export function buildManagedBotLink(suggestedUsername: string, suggestedName: string): string {
  return `https://t.me/newbot/${platformBotUsername()}/${suggestedUsername}?name=${encodeURIComponent(suggestedName)}`;
}

export function randomBotUsername(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `tolk_${s}_bot`;
}

async function managerCall<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = process.env.SUPPORT_TG_BOT_TOKEN;
  if (!token) throw new Error("SUPPORT_TG_BOT_TOKEN не задан");
  const res = await fetch(telegramBotUrl(token, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!res.ok || !j?.ok) throw new Error(`${method}: ${j?.description ?? res.status}`);
  return j.result as T;
}

/** Best-effort оформление бота: описание, которое увидят клиенты. */
async function brandBot(botToken: string): Promise<void> {
  const call = (method: string, body: Record<string, unknown>) =>
    fetch(telegramBotUrl(botToken, method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
  await call("setMyDescription", {
    description: "Бот вашего психолога на платформе ТОЛК. Нажмите «Начать», чтобы подключить переписку, и пишите сюда между сессиями — психолог ответит.",
  });
  await call("setMyShortDescription", { short_description: "Бот вашего психолога · платформа ТОЛК" });
}

/** Обработка update.managed_bot от платформенного бота. */
export async function handleManagedBotUpdate(db: SupabaseClient, mb: ManagedBotUpdate): Promise<void> {
  const botUser = mb.bot ?? mb.bot_user;
  const creator = mb.user;
  if (!botUser?.id) return;

  const token = await managerCall<string>("getManagedBotToken", { user_id: botUser.id });
  const info = await getTelegramBotInfo(token);
  const username = info.username;

  // 1) Бот уже подключён — это смена токена/владельца: обновляем токен.
  const { data: existing } = await db
    .from("messenger_integrations")
    .select("id")
    .eq("platform", "telegram")
    .ilike("bot_username", username)
    .maybeSingle();
  if (existing?.id) {
    await db.from("messenger_integrations").update({ bot_token: token, status: "connected", last_error: null }).eq("id", existing.id);
    return;
  }

  // 2) Ищем запрос: по предложенному username, иначе по привязанному Telegram создателя.
  const since = new Date(Date.now() - REQUEST_TTL_MS).toISOString();
  type Req = { id: string; psychologist_id: string };
  let reqRow = null as Req | null;
  const { data: byName } = await db
    .from("managed_bot_requests")
    .select("id, psychologist_id")
    .eq("status", "pending")
    .gte("created_at", since)
    .ilike("suggested_username", username)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  reqRow = (byName as Req | null) ?? null;

  if (!reqRow && creator?.id) {
    // Один Telegram может быть привязан к нескольким аккаунтам — берём того, у кого есть ожидающий запрос.
    const { data: chans } = await db
      .from("notification_channels")
      .select("user_id")
      .eq("channel", "telegram")
      .eq("chat_id", String(creator.id));
    const ids = (chans ?? []).map((c) => c.user_id as string);
    if (ids.length) {
      const { data: byUser } = await db
        .from("managed_bot_requests")
        .select("id, psychologist_id")
        .eq("status", "pending")
        .gte("created_at", since)
        .in("psychologist_id", ids)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      reqRow = (byUser as Req | null) ?? null;
    }
  }
  // Чужого бота никому не подключаем: без однозначного соответствия запросу — игнорируем.
  if (!reqRow) {
    console.warn(`managed_bot: нет запроса для @${username}, запоминаем до привязки Telegram создателя`);
    await db.from("managed_bot_orphans").upsert(
      { bot_id: botUser.id, bot_username: username, creator_tg_id: creator?.id ?? null, created_at: new Date().toISOString() },
      { onConflict: "bot_id" }
    );
    return;
  }
  await db.from("managed_bot_orphans").delete().eq("bot_id", botUser.id);

  await connectManagedBot(db, reqRow.psychologist_id, token, username, reqRow.id);
}

/** Сохраняет бота как Telegram-интеграцию психолога и закрывает запрос. */
async function connectManagedBot(db: SupabaseClient, psychologistId: string, token: string, username: string, requestId: string | null): Promise<void> {
  const { data: current } = await db
    .from("messenger_integrations")
    .select("id")
    .eq("psychologist_id", psychologistId)
    .eq("platform", "telegram")
    .maybeSingle();
  const { error } = await db.from("messenger_integrations").upsert(
    {
      id: current?.id,
      psychologist_id: psychologistId,
      platform: "telegram",
      bot_token: token,
      bot_username: username,
      status: "connected",
      connected_at: new Date().toISOString(),
      last_error: null,
    },
    { onConflict: "psychologist_id,platform" }
  );
  if (error) {
    if (requestId) await db.from("managed_bot_requests").update({ status: "error", error: error.message, done_at: new Date().toISOString() }).eq("id", requestId);
    throw new Error(`save integration: ${error.message}`);
  }
  if (requestId) await db.from("managed_bot_requests").update({ status: "done", bot_username: username, done_at: new Date().toISOString() }).eq("id", requestId);
  void brandBot(token);
  void notifyUserTelegram(psychologistId, `Готово ✅ Бот @${username} создан и подключён к ТОЛК. Ссылку для клиентов можно получить в разделе «Клиенты».`);
}

/**
 * Вызывается после привязки Telegram психолога к аккаунту: если он недавно создал бота (с другим username,
 * чем предложили) и запрос ждёт — подключаем этого бота.
 */
export async function claimManagedBotsForChat(db: SupabaseClient, userId: string, chatId: string): Promise<void> {
  const since = new Date(Date.now() - REQUEST_TTL_MS).toISOString();
  const creatorId = Number(chatId);
  if (!Number.isFinite(creatorId)) return;
  const { data: orphan } = await db
    .from("managed_bot_orphans")
    .select("bot_id, bot_username")
    .eq("creator_tg_id", creatorId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!orphan) return;
  const { data: req } = await db
    .from("managed_bot_requests")
    .select("id")
    .eq("psychologist_id", userId)
    .eq("status", "pending")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!req) return;
  const token = await managerCall<string>("getManagedBotToken", { user_id: orphan.bot_id });
  const info = await getTelegramBotInfo(token);
  await connectManagedBot(db, userId, token, info.username, req.id as string);
  await db.from("managed_bot_orphans").delete().eq("bot_id", orphan.bot_id);
}
