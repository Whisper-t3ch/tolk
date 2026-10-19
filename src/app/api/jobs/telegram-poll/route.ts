import { NextRequest, NextResponse } from "next/server";
import { telegramBotUrl } from "@/lib/messengers/telegramApi";
import { createAdminClient } from "@/lib/supabase/admin";
import { handlePlatformUpdate, type TgUpdate } from "@/lib/notify/platformTelegramHandler";
import { handleClientTelegramUpdate, backfillTelegramAvatars } from "@/lib/messengers/telegramInbound";

// GET/POST /api/jobs/telegram-poll — приём сообщений Telegram через long polling.
// Нужен, потому что Telegram не может достучаться до tolkplace.ru с вебхуком, а сами мы
// ходим в Telegram через прокси (TELEGRAM_API_BASE). Опрашиваются параллельно:
//  • платформенный бот (SUPPORT_TG_BOT_TOKEN) — привязка уведомлений, ответы поддержки;
//  • боты психологов (messenger_integrations, platform=telegram, status=connected) —
//    сообщения клиентов и привязка по ссылке /start <client_id>.
// Cron раз в минуту вызывает этот эндпоинт (deploy/core/telegram_poll_cron.sh, под flock);
// каждый вызов держится ~50 секунд. Авторизация — Bearer CRON_SECRET (как у /api/jobs/process).

export const dynamic = "force-dynamic";

const BUDGET_MS = 50_000; // сколько суммарно опрашиваем за один вызов
const LONG_POLL_S = 20;   // таймаут одного getUpdates
const MAX_CLIENT_BOTS = 60;

function checkAuth(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function getUpdates(token: string, offset: number | undefined, timeoutS: number): Promise<{ ok: boolean; status: number; result: TgUpdate[] }> {
  const res = await fetch(telegramBotUrl(token, "getUpdates"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offset, timeout: timeoutS, allowed_updates: ["message"] }),
    signal: AbortSignal.timeout((timeoutS + 10) * 1000),
  });
  if (!res.ok) return { ok: false, status: res.status, result: [] };
  const j = (await res.json()) as { ok: boolean; result?: TgUpdate[] };
  return { ok: !!j.ok, status: 200, result: j.result ?? [] };
}

/** Опрашивает одного бота до исчерпания бюджета. Возвращает число обработанных обновлений. */
async function pollBot(token: string, onUpdate: (u: TgUpdate) => Promise<void>): Promise<{ processed: number; error?: string }> {
  const started = Date.now();
  let offset: number | undefined;
  let processed = 0;
  try {
    for (;;) {
      const remaining = BUDGET_MS - (Date.now() - started);
      // Последний вызов с timeout=0 нужен, чтобы подтвердить (offset) уже обработанные обновления.
      const timeoutS = remaining > 3000 ? Math.min(LONG_POLL_S, Math.floor(remaining / 1000)) : 0;
      let r = await getUpdates(token, offset, timeoutS);
      if (!r.ok && r.status === 409) {
        // На боте остался вебхук — снимаем его и пробуем снова.
        await fetch(telegramBotUrl(token, "deleteWebhook"), { method: "POST", signal: AbortSignal.timeout(10_000) });
        r = await getUpdates(token, offset, timeoutS);
      }
      if (!r.ok) return { processed, error: `getUpdates ${r.status}` };
      for (const u of r.result) {
        try {
          await onUpdate(u);
        } catch (e) {
          console.error("telegram-poll update error:", e instanceof Error ? e.message : e);
        }
        processed++;
        if (typeof u.update_id === "number") offset = u.update_id + 1;
      }
      if (timeoutS === 0) break;
    }
  } catch (e) {
    return { processed, error: e instanceof Error ? e.message : String(e) };
  }
  return { processed };
}

async function handle(request: NextRequest) {
  if (!checkAuth(request)) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const platformToken = process.env.SUPPORT_TG_BOT_TOKEN;
  const db = createAdminClient();
  const jobs: Promise<{ processed: number; error?: string }>[] = [];
  const labels: string[] = [];

  if (platformToken) {
    labels.push("platform");
    jobs.push(pollBot(platformToken, handlePlatformUpdate));
  }

  const { data: bots } = await db
    .from("messenger_integrations")
    .select("psychologist_id, bot_token")
    .eq("platform", "telegram")
    .eq("status", "connected")
    .not("bot_token", "is", null)
    .limit(MAX_CLIENT_BOTS);
  for (const b of bots ?? []) {
    const token = b.bot_token as string;
    if (!token || token === platformToken) continue;
    // Аватарки уже привязанных клиентов — в фоне, не мешая опросу.
    void backfillTelegramAvatars(db, b.psychologist_id as string, token).catch(() => {});
    labels.push(`psy:${String(b.psychologist_id).slice(0, 8)}`);
    jobs.push(pollBot(token, (u) => handleClientTelegramUpdate(db, b.psychologist_id as string, { bot_token: token }, u)));
  }

  if (jobs.length === 0) return NextResponse.json({ error: "нет ботов для опроса" }, { status: 500 });
  const results = await Promise.all(jobs);
  const processed = results.reduce((s, r) => s + r.processed, 0);
  const errors = results.map((r, i) => (r.error ? `${labels[i]}: ${r.error}` : null)).filter(Boolean);
  return NextResponse.json({ ok: errors.length === 0, processed, bots: jobs.length, ...(errors.length ? { errors } : {}) });
}

export const GET = handle;
export const POST = handle;
