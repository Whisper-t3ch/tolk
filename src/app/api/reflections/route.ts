import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/reflections — список записей дневника психолога, новые сверху.
// POST /api/reflections — создать запись.
// Body (POST): { title: string, content?: string, tags?: string[], client_id?: string }
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("reflections")
    .select("id, title, content, tags, client_id, created_at, clients(name)")
    .eq("psychologist_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ reflections: data });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { title?: string; content?: string; tags?: string[]; client_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const title = body.title?.trim();
  if (!title) {
    return NextResponse.json({ error: "Укажите title" }, { status: 400 });
  }

  if (body.client_id) {
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("id", body.client_id)
      .eq("psychologist_id", user.id)
      .maybeSingle();
    if (!client) {
      return NextResponse.json({ error: "Клиент не найден" }, { status: 404 });
    }
  }

  const { data, error } = await supabase
    .from("reflections")
    .insert({
      psychologist_id: user.id,
      title,
      content: body.content ?? "",
      tags: body.tags ?? [],
      client_id: body.client_id ?? null,
    })
    .select("id, title, content, tags, client_id, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ reflection: data });
}
