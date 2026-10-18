import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupportAdmin } from "@/lib/supportAdmin";

const STATUSES = ["new", "in_progress", "resolved"];

// GET /api/admin/support?status=new|in_progress|resolved|all&limit=50
export async function GET(request: NextRequest) {
  if (!(await isSupportAdmin(request))) return NextResponse.json({ error: "Нет доступа" }, { status: 403 });

  const status = request.nextUrl.searchParams.get("status") ?? "new";
  const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 50));
  const db = createAdminClient();
  let q = db
    .from("support_tickets")
    .select("id, created_at, email, subject, message, page_url, user_agent, status")
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

// PATCH /api/admin/support { id, status }
export async function PATCH(request: NextRequest) {
  if (!(await isSupportAdmin(request))) return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  let body: { id?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }
  if (!body.id || !body.status || !STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "Нужны id и status (new|in_progress|resolved)" }, { status: 400 });
  }
  const { error } = await createAdminClient().from("support_tickets").update({ status: body.status }).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
