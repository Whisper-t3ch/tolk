import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { platformBotUsername } from "@/lib/notify/platformTelegram";

// GET    /api/notifications/telegram — привязан ли Telegram.
// POST   /api/notifications/telegram — создать одноразовую ссылку привязки (t.me/<bot>?start=<token>).
// DELETE /api/notifications/telegram — отвязать.

async function currentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const { data } = await createAdminClient()
    .from("notification_channels")
    .select("username")
    .eq("user_id", user.id)
    .eq("channel", "telegram")
    .maybeSingle();
  return NextResponse.json({ connected: !!data, username: data?.username ?? null, bot: platformBotUsername() });
}

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const db = createAdminClient();
  const token = randomBytes(18).toString("base64url");
  // Чистим просроченные и прежние токены пользователя — актуален только последний.
  await db.from("notification_link_tokens").delete().eq("user_id", user.id);
  await db.from("notification_link_tokens").delete().lt("expires_at", new Date().toISOString());
  const { error } = await db.from("notification_link_tokens").insert({
    token,
    user_id: user.id,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  if (error) return NextResponse.json({ error: "Не удалось создать ссылку" }, { status: 500 });
  return NextResponse.json({ url: `https://t.me/${platformBotUsername()}?start=${token}`, bot: platformBotUsername() });
}

export async function DELETE() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  await createAdminClient().from("notification_channels").delete().eq("user_id", user.id).eq("channel", "telegram");
  return NextResponse.json({ ok: true });
}
