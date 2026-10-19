import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyUserTelegram } from "@/lib/notify/platformTelegram";

/**
 * Сохраняет ответ поддержки и доставляет его автору обращения:
 *  • в приложении (колокольчик и страница «Помощь» — читают reply/replied_at),
 *  • в Telegram, если пользователь привязал чат.
 * Email-доставка добавится после подключения SMTP.
 */
export async function applySupportReply(
  db: SupabaseClient,
  ticket: { id?: string; shortId?: string },
  reply: string
): Promise<{ ok: boolean; error?: string; ticketId?: string; telegram?: boolean }> {
  const text = reply.trim();
  if (!text) return { ok: false, error: "Пустой ответ" };
  if (text.length > 4000) return { ok: false, error: "Ответ слишком длинный" };

  let q = db.from("support_tickets").select("id, psychologist_id, message");
  q = ticket.id ? q.eq("id", ticket.id) : q.eq("short_id", ticket.shortId ?? "");
  const { data: found, error } = await q.limit(1).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!found) return { ok: false, error: "Обращение не найдено" };

  const { error: upErr } = await db
    .from("support_tickets")
    .update({ reply: text, replied_at: new Date().toISOString(), status: "resolved" })
    .eq("id", found.id);
  if (upErr) return { ok: false, error: upErr.message };

  const short = String(found.id).slice(0, 8);
  const tg = await notifyUserTelegram(
    found.psychologist_id as string,
    `Ответ поддержки ТОЛК на ваше обращение #${short}:\n\n${text}`
  );
  return { ok: true, ticketId: found.id as string, telegram: tg };
}
