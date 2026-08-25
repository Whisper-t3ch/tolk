import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkYandexGptEnv, yandexGptEmbed, YandexGptError } from "@/lib/yandexgpt";

// Грубое разбиение на чанки ~500 токенов. Точный подсчёт токенов
// потребовал бы отдельного токенизатора — используем эвристику
// "1 токен ≈ 4 символа русского/английского текста", разбивая по
// границам абзацев, чтобы не рвать предложения посередине.
const CHARS_PER_CHUNK = 500 * 4;

function splitIntoChunks(content: string): string[] {
  const paragraphs = content.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > CHARS_PER_CHUNK && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += (current ? "\n\n" : "") + para;
    // Абзац сам по себе длиннее лимита — режем его по символам.
    while (current.length > CHARS_PER_CHUNK) {
      chunks.push(current.slice(0, CHARS_PER_CHUNK).trim());
      current = current.slice(CHARS_PER_CHUNK);
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [content.trim()];
}

// POST /api/knowledge
// Body: { title?: string, content: string, source_type: 'technique'|'article'|'protocol'|'manual', approach?: string }
// Разбивает content на чанки, создаёт эмбеддинг для каждого через
// YandexGPT Embeddings, сохраняет каждый чанк отдельной строкой в
// knowledge_base. Не расходует лимит ассистента.
export async function POST(request: NextRequest) {
  const envStatus = checkYandexGptEnv();
  if (!envStatus.configured) {
    return NextResponse.json(
      { error: `YandexGPT не настроен. Добавьте ключи в .env: ${envStatus.missing.join(", ")}` },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { title?: string; content?: string; source_type?: string; approach?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const content = body.content?.trim();
  if (!content) {
    return NextResponse.json({ error: "Укажите content" }, { status: 400 });
  }
  const allowedSourceTypes = ["technique", "article", "protocol", "manual"];
  if (!body.source_type || !allowedSourceTypes.includes(body.source_type)) {
    return NextResponse.json({ error: `source_type должен быть одним из: ${allowedSourceTypes.join(", ")}` }, { status: 400 });
  }

  const chunks = splitIntoChunks(content);

  const rows: Array<{
    psychologist_id: string;
    title: string | null;
    content: string;
    embedding: number[];
    source_type: string;
    approach: string | null;
  }> = [];

  try {
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await yandexGptEmbed(chunks[i], "doc");
      rows.push({
        psychologist_id: user.id,
        title: chunks.length > 1 ? `${body.title ?? "Материал"} (часть ${i + 1}/${chunks.length})` : (body.title ?? null),
        content: chunks[i],
        embedding,
        source_type: body.source_type,
        approach: body.approach ?? null,
      });
    }
  } catch (e) {
    const message = e instanceof YandexGptError ? e.message : "Не удалось создать эмбеддинги";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const { data, error } = await supabase
    .from("knowledge_base")
    .insert(rows)
    .select("id, title, source_type, approach, created_at");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data, chunks_created: rows.length });
}

// GET /api/knowledge — список материалов текущего психолога
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("knowledge_base")
    .select("id, title, content, source_type, approach, created_at")
    .eq("psychologist_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}

// DELETE /api/knowledge?id=<uuid>
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Укажите ?id=" }, { status: 400 });
  }

  const { error } = await supabase.from("knowledge_base").delete().eq("id", id).eq("psychologist_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
