import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupportAdmin } from "@/lib/supportAdmin";
import { applySupportReply } from "@/lib/support/reply";

const STATUSES = ["new", "in_progress", "resolved"];

// GET /api/admin/support?status=new|in_progress|resolved|all&limit=50
export async function GET(request: NextRequest) {
  if (!(await isSupportAdmin(request))) return NextResponse.json({ error: "Нет доступа" }, { status: 403 });

  const status = request.nextUrl.searchParams.get("status") ?? "new";
  const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 50));
  const db = createAdminClient();
  let q = db
    .from("support_tickets")
    .select("id, created_at, email, subject, message, page_url, user_agent, status, reply, replied_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status !== "all") {
    if (!STATUSES.includes(status)) return NextResponse.json({ error: "Неверный status" }, { status: 400 });
    q = q.eq("status", status);
  }
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

// PATCH /api/admin/support { id, status? , reply? }
// reply — ответ пользователю (сохраняется, обращение → resolved, доставка в приложение и Telegram).
export async function PATCH(request: NextRequest) {
  if (!(await isSupportAdmin(request))) return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  let body: { id?: string; status?: string; reply?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "Нужен id" }, { status: 400 });
  const db = createAdminClient();
  if (typeof body.reply === "string") {
    const r = await applySupportReply(db, { id: body.id }, body.reply);
    if (!r.ok) return NextResponse.json({ error: r.error ?? "Ошибка" }, { status: 400 });
    return NextResponse.json({ ok: true, telegram: r.telegram ?? false });
  }
  if (!body.status || !STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "Нужен status (new|in_progress|resolved) или reply" }, { status: 400 });
  }
  const { error } = await db.from("support_tickets").update({ status: body.status }).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
