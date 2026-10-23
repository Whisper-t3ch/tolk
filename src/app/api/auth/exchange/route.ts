import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/auth/exchange { code } — обмен кода из письма (PKCE) на сессию; code-verifier лежит в куке браузера.
export async function POST(request: NextRequest) {
  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { message: "Bad request", status: 400 } }, { status: 400 });
  }
  if (!body.code || typeof body.code !== "string") return NextResponse.json({ error: { message: "Bad request", status: 400 } }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(body.code);
  if (error) return NextResponse.json({ error: { message: error.message, status: error.status ?? 400 } }, { status: 400 });
  return NextResponse.json({ ok: true });
}
