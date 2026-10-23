import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/tests/questionnaires — список интерактивных опросников для отправки клиенту.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const { data, error } = await supabase.from("test_questionnaires").select("test_key, title").order("title", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ questionnaires: data ?? [] });
}
