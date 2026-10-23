import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/auth/logout — выход: отзывает сессию и стирает HttpOnly-куку.
export async function POST() {
  const supabase = await createClient();
  try {
    await supabase.auth.signOut();
  } catch {
    // сессия уже недействительна — куки всё равно очищаются
  }
  return NextResponse.json({ ok: true });
}
