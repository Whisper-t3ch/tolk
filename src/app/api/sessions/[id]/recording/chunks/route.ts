import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { extensionForMimeType } from "@/lib/recording/mime";

// POST /api/sessions/[id]/recording/chunks
// multipart/form-data: track, sequence, startedAtMs, durationMs, checksum,
// mimeType, blob (файл). Отправляется src/lib/recording/uploader.ts из
// браузера психолога — одна консультация, десятки вызовов (фрагмент
// каждые ~20с на дорожку).
//
// Аутентификация — обычная cookie-сессия психолога (createClient(),
// как в soap/route.ts), НЕ service role: это первый запрос в цепочке
// Этапа 2, где реально нужна проверка "эта сессия принадлежит именно
// этому психологу" перед тем, как положить байты в Storage — тот же
// принцип владения, что у RLS-политик session_recording_chunks
// (migration_036) и session-recordings (migration_037, см. её
// комментарии про то, какая политика что разрешает).
//
// Идемпотентность: retry одного и того же фрагмента (see uploader.ts)
// не должен плодить дубли и не должен считаться ошибкой — upsert и в
// Storage (upload с upsert:true), и в БД (on_conflict по
// session_id,track,sequence) делают повтор безопасным no-op с тем же
// результатом.
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
    .select("id, recording_status")
    .eq("id", sessionId)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса (ожидался multipart/form-data)" }, { status: 400 });
  }

  const track = form.get("track");
  const sequenceRaw = form.get("sequence");
  const startedAtMsRaw = form.get("startedAtMs");
  const durationMsRaw = form.get("durationMs");
  const checksum = form.get("checksum");
  const mimeType = form.get("mimeType");
  const blob = form.get("blob");

  if (track !== "psychologist" && track !== "client") {
    return NextResponse.json({ error: "track должен быть 'psychologist' или 'client'" }, { status: 400 });
  }
  const sequence = Number(sequenceRaw);
  const startedAtMs = Number(startedAtMsRaw);
  const durationMs = Number(durationMsRaw);
  if (!Number.isInteger(sequence) || sequence < 0) {
    return NextResponse.json({ error: "sequence должен быть неотрицательным целым" }, { status: 400 });
  }
  if (!Number.isFinite(startedAtMs) || startedAtMs < 0 || !Number.isFinite(durationMs) || durationMs < 0) {
    return NextResponse.json({ error: "startedAtMs/durationMs некорректны" }, { status: 400 });
  }
  if (typeof checksum !== "string" || !checksum.startsWith("sha256:")) {
    return NextResponse.json({ error: "checksum отсутствует или в неверном формате" }, { status: 400 });
  }
  if (typeof mimeType !== "string" || !mimeType) {
    return NextResponse.json({ error: "mimeType обязателен" }, { status: 400 });
  }
  if (!(blob instanceof Blob) || blob.size === 0) {
    return NextResponse.json({ error: "blob отсутствует или пуст" }, { status: 400 });
  }

  const buffer = Buffer.from(await blob.arrayBuffer());

  // Сверка checksum ДО записи куда-либо — фрагмент, дошедший битым
  // (оборванная выгрузка, сбойный прокси), не должен попасть ни в
  // Storage, ни в реестр: иначе backend решит, что фрагмент цел, а
  // при сборке дорожки получит повреждённый контейнер.
  const actualChecksum = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
  if (actualChecksum !== checksum) {
    return NextResponse.json(
      { error: "checksum не совпал — фрагмент дошёл повреждённым, нужен повтор" },
      { status: 422 }
    );
  }

  const ext = extensionForMimeType(mimeType);
  const storageKey = `recordings/${sessionId}/${track}/${String(sequence).padStart(6, "0")}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("session-recordings")
    .upload(storageKey, buffer, { contentType: mimeType, upsert: true });
  if (uploadError) {
    return NextResponse.json({ error: `Не удалось сохранить фрагмент в хранилище: ${uploadError.message}` }, { status: 502 });
  }

  const { error: insertError } = await supabase
    .from("session_recording_chunks")
    .upsert(
      {
        session_id: sessionId,
        track,
        sequence,
        storage_key: storageKey,
        mime_type: mimeType,
        size_bytes: buffer.byteLength,
        checksum,
        started_at_ms: Math.round(startedAtMs),
        duration_ms: Math.round(durationMs),
      },
      { onConflict: "session_id,track,sequence" }
    );
  if (insertError) {
    return NextResponse.json({ error: `Не удалось записать метаданные фрагмента: ${insertError.message}` }, { status: 500 });
  }

  // Первый дошедший фрагмент — сигнал, что запись реально пошла.
  // Дальше статус двигают heartbeat (recording_heartbeat_at) и
  // manifest (финальный статус) — этот route его не трогает, если
  // консультация уже прошла дальше стадии 'none'/'recording'.
  if (session.recording_status === "none" || session.recording_status === null) {
    await supabase
      .from("sessions")
      .update({ recording_status: "recording", recording_heartbeat_at: new Date().toISOString() })
      .eq("id", sessionId);
  } else {
    await supabase.from("sessions").update({ recording_heartbeat_at: new Date().toISOString() }).eq("id", sessionId);
  }

  return NextResponse.json({ ok: true, track, sequence });
}
