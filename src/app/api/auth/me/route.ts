import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/auth/me — кто вошёл (проверяется на сервере Supabase Auth). Токены страницам не отдаются.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return NextResponse.json(
    { user: user ? { id: user.id, email: user.email ?? null } : null },
    { headers: { "cache-control": "no-store" } }
  );
}
