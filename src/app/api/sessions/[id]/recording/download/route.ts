import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extensionForMimeType } from "@/lib/recording/mime";

// GET /api/sessions/[id]/recording/download?attemptId=...&track=psychologist|client
//
// 25.09.2026, см. claude/recording-stop-fix-plan.md в проекте.
// Безопасный способ прослушать/скачать ЗАПИСЬ КОРОТКОГО ТЕСТА через
// уже существующую авторизацию приложения — НЕ через service-role,
// НЕ через сторонний консольный скрипт, НЕ передавая аудио или ключи
// куда-либо ещё. Владение сессией проверяется тем же обычным,
// RLS-связанным серверным клиентом (createClient() по cookie
// психолога), что и в остальных recording-роутах — тем же способом,
// каким уже авторизован остальной интерфейс. После починки RLS-
// индекса storage.foldername(...)[1] (test_env_002_...sql) обычный
// клиент имеет право на select собственных объектов в Storage — этому
// роуту service-role не нужен вообще.
//
// НАМЕРЕННОЕ ОГРАНИЧЕНИЕ (по прямому указанию — не проектировать это
// как решение для скачивания ПОЛНОЙ консультации): жёсткий предел
// MAX_DOWNLOAD_BYTES ниже. Serverless-функция Vercel буферизует все
// байты трека в памяти процесса перед ответом — для короткого теста
// (секунды-минуты речи в Opus, реально десятки-сотни КБ) это безопасно,
// для часовой консультации (десятки МБ) — нет: и по памяти/времени
// выполнения функции, и просто потому что один HTTP-ответ без
// потоковой отдачи — не тот дизайн, которым стоит скачивать
// production-запись. Если/когда понадобится реальная выгрузка полных
// консультаций — это отдельная задача (потоковая отдача или фоновая
// сборка с отдельным artifact'ом), сознательно не решается здесь.
//
// Ничего из содержимого фрагментов (байты, checksum-как-контент) нигде
// не логируется этим роутом.
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024; // 20 МБ — с большим запасом покрывает короткий тест, не покрывает консультацию

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    .select("id, recording_manifest")
    .eq("id", sessionId)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }

  const url = new URL(request.url);
  const track = url.searchParams.get("track");
  if (track !== "psychologist" && track !== "client") {
    return NextResponse.json({ error: "Параметр track обязателен: 'psychologist' или 'client'" }, { status: 400 });
  }

  const manifest = session.recording_manifest as { attemptId?: string | null } | null;
  const attemptId = url.searchParams.get("attemptId") ?? manifest?.attemptId ?? null;
  if (!attemptId) {
    return NextResponse.json(
      { error: "attemptId не передан и не найден в сохранённом manifest этой сессии" },
      { status: 400 }
    );
  }

  // attemptId обязан принадлежать этой сессии — та же явная проверка,
  // что и в authorize/confirm.
  const { data: attempt, error: attemptError } = await supabase
    .from("recording_attempts")
    .select("id")
    .eq("id", attemptId)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (attemptError) {
    return NextResponse.json({ error: attemptError.message }, { status: 500 });
  }
  if (!attempt) {
    return NextResponse.json({ error: "attemptId не найден для этой сессии" }, { status: 404 });
  }

  const { data: chunks, error: chunksError } = await supabase
    .from("session_recording_chunks")
    .select("sequence, storage_key, mime_type, size_bytes")
    .eq("session_id", sessionId)
    .eq("recording_attempt_id", attemptId)
    .eq("track", track)
    .order("sequence", { ascending: true });
  if (chunksError) {
    return NextResponse.json({ error: chunksError.message }, { status: 500 });
  }
  if (!chunks || chunks.length === 0) {
    return NextResponse.json({ error: "Для этой попытки/дорожки нет подтверждённых фрагментов" }, { status: 404 });
  }

  // Дыры в нумерации здесь не должны попадаться (manifest-роут это уже
  // проверяет перед тем, как признать попытку готовой), но повторная
  // проверка тут дешёвая и защищает от отдачи заведомо битого файла,
  // если этот роут вызвали до того, как сверка вообще прошла.
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].sequence !== i) {
      return NextResponse.json(
        { error: `В реестре есть дыра в нумерации (позиция ${i}, sequence=${chunks[i].sequence}) — склейка была бы повреждённой` },
        { status: 409 }
      );
    }
  }

  const totalBytes = chunks.reduce((sum, c) => sum + (c.size_bytes ?? 0), 0);
  if (totalBytes > MAX_DOWNLOAD_BYTES) {
    return NextResponse.json(
      {
        error:
          `Запись (${Math.round(totalBytes / 1024 / 1024)} МБ) превышает лимит этого диагностического роута ` +
          `(${MAX_DOWNLOAD_BYTES / 1024 / 1024} МБ, только для коротких тестов — см. комментарий в route.ts). ` +
          "Скачивание полных консультаций требует отдельного решения (потоковая отдача), здесь сознательно не реализовано.",
      },
      { status: 413 }
    );
  }

  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    const { data: blob, error: downloadError } = await supabase.storage
      .from("session-recordings")
      .download(chunk.storage_key);
    if (downloadError || !blob) {
      return NextResponse.json(
        { error: `Не удалось скачать фрагмент #${chunk.sequence} из хранилища: ${downloadError?.message ?? "пустой ответ"}` },
        { status: 502 }
      );
    }
    buffers.push(Buffer.from(await blob.arrayBuffer()));
  }

  const combined = Buffer.concat(buffers);
  const mimeType = chunks[0].mime_type || "application/octet-stream";
  const ext = extensionForMimeType(mimeType);
  const filename = `${sessionId}_${track}_${attemptId}.${ext}`;

  return new NextResponse(combined, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(combined.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
