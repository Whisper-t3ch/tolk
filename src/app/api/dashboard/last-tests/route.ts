import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TEST_SCALES, type TestType } from "@/lib/testScales";

// GET /api/dashboard/last-tests — последний завершённый тест по каждому клиенту психолога
// (для колонки «Последний тест» на дашборде).
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { data, error } = await supabase
    .from("test_results")
    .select("client_id, test_type, score, max_score, created_at, test_questionnaires ( title )")
    .eq("psychologist_id", user.id)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const last: Record<string, { name: string; score: number; maxScore: number; createdAt: string }> = {};
  for (const row of data ?? []) {
    const cid = row.client_id as string;
    if (last[cid]) continue; // первые в списке — самые свежие
    const rel = row.test_questionnaires as { title?: string } | { title?: string }[] | null;
    const title = (Array.isArray(rel) ? rel[0] : rel)?.title;
    last[cid] = {
      name: title || TEST_SCALES[row.test_type as TestType]?.label || (row.test_type as string),
      score: row.score as number,
      maxScore: row.max_score as number,
      createdAt: row.created_at as string,
    };
  }
  return NextResponse.json({ last });
}
