import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/support { message, pageUrl? }
// Сохраняет обращение в support_tickets (migration 044) и, если заданы
// SUPPORT_TG_BOT_TOKEN + SUPPORT_TG_CHAT_ID, мгновенно шлёт его владельцу
// в Telegram. Доставка в Telegram — best-effort: обращение уже сохранено.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  let body: { message?: string; pageUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }
  const message = body.message?.trim();
  if (!message) return NextResponse.json({ error: "Опишите вопрос или проблему" }, { status: 400 });
  if (message.length > 5000) return NextResponse.json({ error: "Слишком длинное сообщение (до 5000 символов)" }, { status: 400 });

  const name = typeof user.user_metadata?.name === "string" ? user.user_metadata.name : "";
  const { data, error } = await supabase
    .from("support_tickets")
    .insert({
      psychologist_id: user.id,
      email: user.email ?? null,
      subject: name || null,
      message,
      page_url: body.pageUrl?.slice(0, 500) ?? null,
      user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    })
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: "Не удалось отправить обращение. Попробуйте позже." }, { status: 500 });
  }

  const token = process.env.SUPPORT_TG_BOT_TOKEN;
  const chatId = process.env.SUPPORT_TG_CHAT_ID;
  let notified = false;
  if (token && chatId) {
    try {
      const text = `Обращение в поддержку ТОЛК #${String(data.id).slice(0, 8)}\n${name || "—"} <${user.email ?? "нет email"}>\n\n${message}`;
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
        signal: AbortSignal.timeout(8000),
      });
      notified = res.ok;
    } catch {
      notified = false;
    }
  }
  console.log("SUPPORT_TICKET", data.id, notified ? "tg_sent" : "tg_not_sent");
  return NextResponse.json({ ok: true, id: data.id });
}
