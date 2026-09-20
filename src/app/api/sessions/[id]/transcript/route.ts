import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { saveSessionTranscript } from "@/lib/saveSessionTranscript";

// POST /api/sessions/[id]/transcript
// Body: { text: string }
//
// Ручная загрузка транскрипта — для сессий, записанных не через
// платформу (звонок вне Jitsi, встреча очно), или для тестирования.
// Раньше единственным способом попасть в session_transcripts был
// вебхук записи (/api/webhooks/recording, source='jitsi_gigaam') —
// психолог, который вёл сессию иначе, не мог добавить её текст в
// историю клиента вообще, и она выпадала из search_client_history /
// get_period_summary / автогенерации SOAP.
//
// Пайплайн намеренно зеркалит webhooks/recording: анонимизация ДО
// первой записи в БД (raw_text в базе — всегда уже анонимизированный
// текст, читающий код не анонимизирует повторно), затем чанкинг +
// embedding для RAG на каждый чанк отдельно (best-effort по чанку —
// см. lib/transcriptChunking.ts: YandexGPT Embeddings ограничен 2048
// токенами на вход, обычная сессия крупнее лимита целиком, поэтому
// один embedding на весь текст почти всегда падал бы с ошибкой 400).
// source='manual' — то же значение, что уже разрешено CHECK-
// констрейнтом колонки (migration_007_video_asr.sql), отдельное
// значение 'manual_upload' не потребовалось.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "Текст транскрипта не может быть пустым" }, { status: 400 });
  }
  if (text.length > 500_000) {
    return NextResponse.json({ error: "Текст слишком длинный (максимум 500 000 символов)" }, { status: 400 });
  }

  // Владение сессией проверяем явно (не полагаемся только на RLS) — тот
  // же паттерн, что и в soap/route.ts PUT: иначе психолог А мог бы
  // подставить чужой session_id и записать транскрипт в чужую сессию.
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, client_id, clients ( name )")
    .eq("id", sessionId)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }

  const clientRel = Array.isArray(session.clients) ? session.clients[0] : session.clients;
  const clientName = (clientRel as { name?: string } | null)?.name ?? "";

  let chunksTotal: number;
  let chunksEmbedded: number;
  try {
    ({ chunksTotal, chunksEmbedded } = await saveSessionTranscript(supabase, sessionId, clientName, text));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Не удалось сохранить транскрипт" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, embeddingSaved: chunksEmbedded > 0, chunksTotal, chunksEmbedded });
}
