import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extensionForMimeType } from "@/lib/recording/mime";

// POST /api/sessions/[id]/recording/chunks/authorize
//
// Первый шаг прямой (не через Vercel) выгрузки фрагмента. Раньше
// (до 24.09) весь Blob фрагмента шёл в теле POST-запроса на
// /api/sessions/[id]/recording/chunks, и route handler сам грузил
// байты в Storage через supabase.storage(...).upload() — то есть
// каждый фрагмент дважды проезжал через Vercel serverless function
// (один HTTP-запрос браузер→Vercel, один Vercel→Supabase). Это
// работало (chunks в этой архитектуре маленькие — opus 20с ~100-200KB,
// далеко от лимита тела запроса Vercel), но лишний прыжок через
// serverless-функцию не нужен и упирается в её лимиты при более
// крупных фрагментах или худшем битрейте.
//
// Теперь: этот route НЕ видит байт фрагмента вообще. Он только
// проверяет, что сессия принадлежит психологу (тот же owner-check,
// что был в старом chunks route), и выдаёт Supabase-подписанный токен
// на загрузку в ЗАРАНЕЕ ВЫЧИСЛЕННЫЙ путь — createSignedUploadUrl()
// требует INSERT-права на storage.objects ПРЯМО В МОМЕНТ выдачи
// токена (RLS-политика migration_037, тот же JOIN на
// sessions.psychologist_id, что и раньше) — то есть проверка владения
// никуда не делась, просто переместилась на шаг раньше. upsert:true
// нужен, чтобы повторная попытка (см. uploader.ts retry) могла
// перезаписать тот же путь, а не упасть на "уже существует".
//
// Дальше браузер сам грузит Blob напрямую в Supabase Storage
// (uploadToSignedUrl, минуя Vercel полностью) и зовёт
// /recording/chunks (теперь JSON-only "confirm" endpoint, см. тот
// route) с метаданными, БЕЗ байт.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }

  let body: { track?: string; sequence?: number; mimeType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const { track, sequence, mimeType } = body;
  if (track !== "psychologist" && track !== "client") {
    return NextResponse.json({ error: "track должен быть 'psychologist' или 'client'" }, { status: 400 });
  }
  if (!Number.isInteger(sequence) || (sequence as number) < 0) {
    return NextResponse.json({ error: "sequence должен быть неотрицательным целым" }, { status: 400 });
  }
  if (typeof mimeType !== "string" || !mimeType) {
    return NextResponse.json({ error: "mimeType обязателен" }, { status: 400 });
  }

  const ext = extensionForMimeType(mimeType);
  const storageKey = `recordings/${sessionId}/${track}/${String(sequence).padStart(6, "0")}.${ext}`;

  const { data, error } = await supabase.storage
    .from("session-recordings")
    .createSignedUploadUrl(storageKey, { upsert: true });

  if (error || !data) {
    return NextResponse.json(
      { error: `Не удалось выдать разрешение на загрузку: ${error?.message ?? "unknown error"}` },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    path: data.path,
    token: data.token,
    signedUrl: data.signedUrl,
    storageKey,
  });
}
