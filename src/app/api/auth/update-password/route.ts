import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/auth/update-password { password } — смена пароля вошедшего пользователя (после ссылки из письма).
export async function POST(request: NextRequest) {
  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { message: "Bad request", status: 400 } }, { status: 400 });
  }
  const password = body.password ?? "";
  if (password.length < 6) return NextResponse.json({ error: { message: "Password should be at least 6 characters", status: 422 } }, { status: 422 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: { message: "Auth session missing", status: 401 } }, { status: 401 });
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return NextResponse.json({ error: { message: error.message, status: error.status ?? 400 } }, { status: 400 });
  return NextResponse.json({ ok: true });
}
