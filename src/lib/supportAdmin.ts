import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Доступ владельца к обращениям поддержки:
 *  • заголовок Authorization: Bearer ${SUPPORT_ADMIN_TOKEN} (для автоматических проверок), или
 *  • залогиненный психолог, чей email есть в SUPPORT_ADMIN_EMAILS (через запятую).
 * Пока переменные не заданы — доступа нет ни у кого.
 */
export async function isSupportAdmin(request: NextRequest): Promise<boolean> {
  const token = process.env.SUPPORT_ADMIN_TOKEN;
  const header = request.headers.get("authorization");
  if (token && token.length >= 24 && header?.startsWith("Bearer ") && safeEqual(header.slice(7), token)) {
    return true;
  }
  const emails = (process.env.SUPPORT_ADMIN_EMAILS ?? "")
    .split(",")
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) return false;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return !!user?.email && emails.includes(user.email.toLowerCase());
}
