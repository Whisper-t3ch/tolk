import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/clients/[id]/ai-analysis/[analysisId] { key, value: string | null }
// Правка блока ИИ-итогов психологом: value — новый текст, null (или пусто) — удалить блок. Запрос ИИ не тратится.
const KEY_RE = /^[a-z_]{1,40}$/;
const PROTECTED_KEYS = new Set(["state_score", "session_date", "sessions_used", "tests_used"]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; analysisId: string }> }) {
  const { id: clientId, analysisId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  let body: { key?: string; value?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }
  const key = body.key ?? "";
  if (!KEY_RE.test(key) || PROTECTED_KEYS.has(key)) return NextResponse.json({ error: "Этот блок нельзя изменить" }, { status: 400 });
  const value = typeof body.value === "string" ? body.value.trim() : null;
  if (value && value.length > 6000) return NextResponse.json({ error: "Текст блока слишком длинный (максимум 6000 символов)" }, { status: 400 });

  const { data: row, error } = await supabase
    .from("client_ai_analyses")
    .select("id, content")
    .eq("id", analysisId)
    .eq("client_id", clientId)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Анализ не найден" }, { status: 404 });

  const content = { ...(row.content as Record<string, string>) };
  if (value) content[key] = value;
  else delete content[key];

  const { data: saved, error: saveError } = await supabase
    .from("client_ai_analyses")
    .update({ content, edited_at: new Date().toISOString() })
    .eq("id", analysisId)
    .eq("psychologist_id", user.id)
    .select("id, kind, ref, content, score, created_at, auto, edited_at")
    .single();
  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
  return NextResponse.json({ analysis: saved });
}
