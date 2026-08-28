import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/note-templates — пользовательские шаблоны психолога +
// текущий default_template_id (может указывать либо на встроенный
// шаблон вроде "soap", либо на uuid из этой таблицы).
// POST /api/note-templates — создать свой шаблон.
// Body (POST): { name, full_name?, description?, fields?, best_for? }
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const [{ data: templates, error }, { data: profile }] = await Promise.all([
    supabase
      .from("note_templates")
      .select("id, name, full_name, description, fields, best_for, created_at")
      .eq("psychologist_id", user.id)
      .order("created_at", { ascending: false }),
    supabase.from("psychologists").select("default_template_id").eq("id", user.id).maybeSingle(),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    templates,
    default_template_id: profile?.default_template_id ?? "soap",
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: {
    name?: string;
    full_name?: string;
    description?: string;
    fields?: { label: string; hint: string }[];
    best_for?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Укажите name" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("note_templates")
    .insert({
      psychologist_id: user.id,
      name,
      full_name: body.full_name ?? "",
      description: body.description ?? "",
      fields: body.fields ?? [],
      best_for: body.best_for ?? "",
    })
    .select("id, name, full_name, description, fields, best_for, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ template: data });
}
