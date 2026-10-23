import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";

// POST /api/auth/login { email, password } — вход на сервере: сессия попадает только в HttpOnly-куку.
export async function POST(request: NextRequest) {
  const rl = rateLimit(`login:${clientIp(request.headers)}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: { message: "Too many requests", status: 429 } }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  }
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { message: "Bad request", status: 400 } }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  const password = body.password ?? "";
  if (!email || !password) return NextResponse.json({ error: { message: "Invalid login credentials", status: 400 } }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ error: { message: error.message, status: error.status ?? 400 } }, { status: error.status === 429 ? 429 : 401 });
  }
  return NextResponse.json({ ok: true });
}
