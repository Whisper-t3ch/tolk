import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { handlePlatformUpdate, type TgUpdate } from "@/lib/notify/platformTelegramHandler";

// Вебхук платформенного Telegram-бота (@tolk_supp0rt_bot).
// Подлинность — секрет в заголовке X-Telegram-Bot-Api-Secret-Token (задаётся в setWebhook,
// значение — PLATFORM_TG_WEBHOOK_SECRET). Без секрета эндпоинт всегда отвечает 401.
// Логика обработки — в lib/notify/platformTelegramHandler.ts (общая с long-polling).
// На прод-ВМ Telegram не достучится до домена, поэтому по умолчанию используется /api/jobs/telegram-poll.

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function POST(request: NextRequest) {
  const secret = process.env.PLATFORM_TG_WEBHOOK_SECRET;
  const header = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || secret.length < 16 || !safeEqual(header, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let update: TgUpdate;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }
  await handlePlatformUpdate(update);
  return NextResponse.json({ ok: true });
}
