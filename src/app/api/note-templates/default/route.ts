import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/note-templates/default — установить шаблон протокола по
// умолчанию. Body: { template_id: string } — либо id встроенного
// шаблона ("soap"/"dap"/"birp"/"emdr"/"family"), либо uuid из
// note_templates.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { template_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const templateId = body.template_id?.trim();
  if (!templateId) {
    return NextResponse.json({ error: "Укажите template_id" }, { status: 400 });
  }

  const { error } = await supabase
    .from("psychologists")
    .update({ default_template_id: templateId })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, default_template_id: templateId });
}
