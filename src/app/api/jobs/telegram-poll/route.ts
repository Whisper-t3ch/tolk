import { NextRequest, NextResponse } from "next/server";
import { telegramBotUrl } from "@/lib/messengers/telegramApi";
import { handlePlatformUpdate, type TgUpdate } from "@/lib/notify/platformTelegramHandler";

// GET/POST /api/jobs/telegram-poll — приём сообщений платформенного бота через long polling.
// Нужен, потому что Telegram не может достучаться до tolkplace.ru с вебхуком (из-за блокировок
// на стороне Telegram/провайдера), а сами мы ходим в Telegram через прокси (TELEGRAM_API_BASE).
// Cron раз в минуту вызывает этот эндпоинт (deploy/core/telegram_poll_cron.sh, под flock);
// он держит соединение ~50 секунд, получает обновления через getUpdates и обрабатывает их.
// Авторизация — Bearer CRON_SECRET (как у /api/jobs/process).

export const dynamic = "force-dynamic";

const BUDGET_MS = 50_000; // сколько суммарно опрашиваем за один вызов
const LONG_POLL_S = 20;   // таймаут одного getUpdates

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

async function handle(request: NextRequest) {
  if (!checkAuth(request)) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const token = process.env.SUPPORT_TG_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: "SUPPORT_TG_BOT_TOKEN не задан" }, { status: 500 });

  const started = Date.now();
  let offset: number | undefined;
  let processed = 0;
  let calls = 0;
  try {
    for (;;) {
      const remaining = BUDGET_MS - (Date.now() - started);
      // Последний вызов с timeout=0 нужен, чтобы подтвердить (offset) уже обработанные обновления.
      const timeoutS = remaining > 3000 ? Math.min(LONG_POLL_S, Math.floor(remaining / 1000)) : 0;
      let r = await getUpdates(token, offset, timeoutS);
      calls++;
      if (!r.ok && r.status === 409) {
        // На боте остался вебхук — снимаем его и пробуем снова.
        await fetch(telegramBotUrl(token, "deleteWebhook"), { method: "POST", signal: AbortSignal.timeout(10_000) });
        r = await getUpdates(token, offset, timeoutS);
      }
      if (!r.ok) return NextResponse.json({ error: `getUpdates ${r.status}`, processed }, { status: 502 });
      for (const u of r.result) {
        try {
          await handlePlatformUpdate(u);
        } catch (e) {
          console.error("telegram-poll update error:", e instanceof Error ? e.message : e);
        }
        processed++;
        if (typeof u.update_id === "number") offset = u.update_id + 1;
      }
      if (timeoutS === 0) break;
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), processed }, { status: 502 });
  }
  return NextResponse.json({ ok: true, processed, calls });
}

export const GET = handle;
export const POST = handle;
