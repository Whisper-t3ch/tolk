import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildManagedBotLink, randomBotUsername } from "@/lib/messengers/managedBots";

// Автосоздание Telegram-бота психолога (Managed Bots).
// POST — создаёт запрос и возвращает ссылку для подтверждения создания бота в Telegram.
// GET ?id=<request_id> — статус запроса (pending | done | error) для опроса из интерфейса.

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!process.env.SUPPORT_TG_BOT_TOKEN) return NextResponse.json({ error: "Автосоздание ботов не настроено" }, { status: 503 });

  const db = createAdminClient();
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await db
    .from("managed_bot_requests")
    .select("id", { count: "exact", head: true })
    .eq("psychologist_id", user.id)
    .gte("created_at", dayAgo);
  if ((count ?? 0) >= 6) {
    return NextResponse.json({ error: "Слишком много попыток за сутки. Попробуйте позже или подключите бота вручную." }, { status: 429 });
  }

  let name = "Кабинет психолога";
  const { data: prof } = await db.from("psychologists").select("name").eq("id", user.id).maybeSingle();
  const pname = (prof as { name?: string } | null)?.name?.trim();
  if (pname) name = `Кабинет · ${pname}`.slice(0, 60);

  const username = randomBotUsername();
  const { data: row, error } = await db
    .from("managed_bot_requests")
    .insert({ psychologist_id: user.id, suggested_username: username })
    .select("id")
    .single();
  if (error || !row) return NextResponse.json({ error: error?.message ?? "Не удалось создать запрос" }, { status: 500 });

  return NextResponse.json({ id: row.id, username, link: buildManagedBotLink(username, name) });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Не передан id" }, { status: 400 });

  const db = createAdminClient();
  const { data } = await db
    .from("managed_bot_requests")
    .select("status, bot_username, error")
    .eq("id", id)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  return NextResponse.json(data);
}
