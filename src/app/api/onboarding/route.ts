import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkYandexGptEnv, yandexGptEmbed, YandexGptError } from "@/lib/yandexgpt";
import { APPROACH_SEED_KNOWLEDGE, type Approach } from "@/lib/approaches";

const VALID_APPROACHES: Approach[] = ["cbt", "gestalt", "psychoanalysis", "schema", "existential", "integrative", "other"];

// GET /api/onboarding — нужен ли онбординг текущему психологу.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("psychologists")
    .select("approach, specialty, typical_client_request, onboarding_completed_at")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const needsOnboarding = !data?.approach || !data?.specialty || !data?.onboarding_completed_at;
  return NextResponse.json({ needsOnboarding, profile: data ?? null });
}

// POST /api/onboarding
// Body: { approach: Approach, specialty: string, typical_client_request: string }
// Сохраняет ответы онбординга и предзаполняет базу знаний 2-3 базовыми
// техниками для выбранного подхода (с реальными эмбеддингами, чтобы RAG
// ассистента сразу их видел). Если YandexGPT недоступен — онбординг всё
// равно завершается, база знаний просто не предзаполняется (не блокирует
// вход психолога в кабинет из-за временной недоступности внешнего API).
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { approach?: string; specialty?: string; typical_client_request?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const approach = body.approach as Approach | undefined;
  if (!approach || !VALID_APPROACHES.includes(approach)) {
    return NextResponse.json({ error: `approach должен быть одним из: ${VALID_APPROACHES.join(", ")}` }, { status: 400 });
  }
  const specialty = body.specialty?.trim();
  if (!specialty) {
    return NextResponse.json({ error: "Укажите specialty" }, { status: 400 });
  }
  const typicalClientRequest = body.typical_client_request?.trim() ?? "";

  const { error: updateError } = await supabase
    .from("psychologists")
    .update({
      approach,
      specialty,
      typical_client_request: typicalClientRequest,
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Предзаполнение базы знаний — best-effort, не блокирует ответ.
  let seededCount = 0;
  const envStatus = checkYandexGptEnv();
  if (envStatus.configured) {
    try {
      // Не заполняем повторно, если у психолога уже есть материалы —
      // например, он проходит онбординг заново после смены подхода.
      const { count } = await supabase
        .from("knowledge_base")
        .select("id", { count: "exact", head: true })
        .eq("psychologist_id", user.id);

      if (!count || count === 0) {
        const seedItems = APPROACH_SEED_KNOWLEDGE[approach];
        const rows: Array<{
          psychologist_id: string;
          title: string;
          content: string;
          embedding: number[];
          source_type: string;
          approach: string;
        }> = [];
        for (const item of seedItems) {
          const embedding = await yandexGptEmbed(item.content, "doc");
          rows.push({
            psychologist_id: user.id,
            title: item.title,
            content: item.content,
            embedding,
            source_type: "technique",
            approach,
          });
        }
        const { error: insertError } = await supabase.from("knowledge_base").insert(rows);
        if (!insertError) seededCount = rows.length;
      }
    } catch (e) {
      // Не роняем онбординг из-за проблем с эмбеддингами — просто логируем best-effort результат.
      seededCount = 0;
    }
  }

  return NextResponse.json({ ok: true, seededKnowledgeItems: seededCount });
}
