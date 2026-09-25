import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extensionForMimeType } from "@/lib/recording/mime";
import { checkUnresolvedTrack, computeFinalStatus, type TrackValidation } from "@/lib/recording/manifestValidation";

// POST /api/sessions/[id]/recording/chunks
//
// Второй шаг ("confirm") двухшаговой схемы прямой загрузки:
//   1. POST .../chunks/authorize — сервер проверяет владение,
//      attempt_id и выдаёт подписанный токен на конкретный путь (см.
//      тот route — 24.09, теперь включает recording_attempt_id).
//   2. Браузер грузит Blob напрямую в Supabase Storage
//      (uploadToSignedUrl, минуя Vercel — см. uploader.ts).
//   3. Этот route — маленький JSON-запрос с метаданными фрагмента,
//      подтверждающий, что шаг 2 реально прошёл, и записывающий строку
//      в session_recording_chunks.
//
// ПЕРЕРАБОТАНО 24.09.2026 вместе с authorize: путь физического объекта
// и уникальность в БД теперь завязаны на recording_attempt_id, а не
// на голый (session_id, track, sequence) — см.
// migration_038_recording_attempt_id.sql. Путь здесь ВСЕГДА
// пересчитывается сервером из (session_id, attempt_id, track,
// sequence) тем же способом, что и в authorize — НЕ принимается от
// браузера как отдельное поле, чтобы confirm нельзя было обмануть,
// подставив произвольный storage_key на чужой/другой путь.
//
// ЧЕСТНАЯ ОГОВОРКА ПРО ЦЕЛОСТНОСТЬ (checksum — UNVERIFIED до Этапа 3,
// см. migration_039_recording_checksum_verified.sql): сервер байт не
// видит вообще при прямой загрузке — checksum, который присылает
// браузер, НЕ пересчитывается сервером. Здесь проверяется только то,
// что объект действительно существует в Storage по вычисленному пути
// и что его реальный размер (из Storage API) совпадает с заявленным —
// это ловит "confirm без реальной загрузки" и оборванные загрузки, но
// НЕ ловит побитово повреждённый файл правильного размера.
//
// ИДЕМПОТЕНТНОСТЬ (уникальный ключ — (recording_attempt_id, track,
// sequence), не (session_id, track, sequence) — это и есть разница с
// версией до 24.09):
//   - Повтор ТОГО ЖЕ фрагмента ВНУТРИ одной попытки (сеть моргнула до
//     того, как браузер получил ответ confirm, retry шлёт тот же
//     checksum) — БЕЗОПАСНО: upsert перезаписывает строку тем же
//     содержимым, эффект идемпотентен.
//   - Confirm с ДРУГИМ checksum на тот же (attempt_id, track,
//     sequence) — коллизия ВНУТРИ одной попытки (не должна происходить
//     при корректном клиенте — TrackRecorder не переиспользует sequence
//     внутри одного своего экземпляра); ОТКЛОНЯЕТСЯ (409).
//   - Коллизии МЕЖДУ попытками (тот же track+sequence в разных
//     attempt_id) больше не существует как класса — это разные строки
//     с разным recording_attempt_id и разный физический путь в
//     Storage, unique-ключ их не сталкивает вообще.
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
    .select("id, recording_status, recording_manifest, recording_heartbeat_at")
    .eq("id", sessionId)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }

  let body: {
    attemptId?: string;
    track?: string;
    sequence?: number;
    startedAtMs?: number;
    durationMs?: number;
    checksum?: string;
    mimeType?: string;
    sizeBytes?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса (ожидался JSON)" }, { status: 400 });
  }

  const { attemptId, track, sequence, startedAtMs, durationMs, checksum, mimeType, sizeBytes } = body;

  if (typeof attemptId !== "string" || !attemptId) {
    return NextResponse.json({ error: "attemptId обязателен" }, { status: 400 });
  }
  if (track !== "psychologist" && track !== "client") {
    return NextResponse.json({ error: "track должен быть 'psychologist' или 'client'" }, { status: 400 });
  }
  if (!Number.isInteger(sequence) || (sequence as number) < 0) {
    return NextResponse.json({ error: "sequence должен быть неотрицательным целым" }, { status: 400 });
  }
  if (!Number.isFinite(startedAtMs) || (startedAtMs as number) < 0 || !Number.isFinite(durationMs) || (durationMs as number) < 0) {
    return NextResponse.json({ error: "startedAtMs/durationMs некорректны" }, { status: 400 });
  }
  if (typeof checksum !== "string" || !checksum.startsWith("sha256:")) {
    return NextResponse.json({ error: "checksum отсутствует или в неверном формате" }, { status: 400 });
  }
  if (typeof mimeType !== "string" || !mimeType) {
    return NextResponse.json({ error: "mimeType обязателен" }, { status: 400 });
  }
  if (!Number.isFinite(sizeBytes) || (sizeBytes as number) <= 0) {
    return NextResponse.json({ error: "sizeBytes обязателен и должен быть положительным" }, { status: 400 });
  }

  // attemptId обязан принадлежать этой сессии — та же явная проверка,
  // что и в authorize (не полагаемся только на RLS/FK: FK гарантирует
  // существование строки recording_attempts, но не то, что она именно
  // этой сессии).
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

  // Идемпотентность внутри одной попытки: см. заголовок route выше.
  const { data: existing, error: existingError } = await supabase
    .from("session_recording_chunks")
    .select("checksum")
    .eq("recording_attempt_id", attemptId)
    .eq("track", track)
    .eq("sequence", sequence)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json(
      { error: `Не удалось проверить существующую запись фрагмента: ${existingError.message}` },
      { status: 500 }
    );
  }
  if (existing && existing.checksum !== checksum) {
    return NextResponse.json(
      {
        error:
          "Коллизия: для этого (attempt_id, track, sequence) уже подтверждён фрагмент с ДРУГИМ содержимым " +
          "(другой checksum). Внутри одной попытки записи это не ожидается при корректном клиенте.",
      },
      { status: 409 }
    );
  }

  const ext = extensionForMimeType(mimeType);
  const storageKey = `${sessionId}/${attemptId}/${track}/${String(sequence).padStart(6, "0")}.${ext}`;
  const folder = `${sessionId}/${attemptId}/${track}`;
  const filename = `${String(sequence).padStart(6, "0")}.${ext}`;

  const { data: listing, error: listError } = await supabase.storage
    .from("session-recordings")
    .list(folder, { search: filename, limit: 1 });
  if (listError) {
    return NextResponse.json(
      { error: `Не удалось проверить наличие фрагмента в хранилище: ${listError.message}` },
      { status: 502 }
    );
  }
  const stored = listing?.find(f => f.name === filename);
  if (!stored) {
    return NextResponse.json(
      { error: "Фрагмент не найден в хранилище — похоже, прямая загрузка не завершилась" },
      { status: 409 }
    );
  }
  const storedSize = stored.metadata?.size;
  if (typeof storedSize === "number" && storedSize !== sizeBytes) {
    return NextResponse.json(
      {
        error: `Размер в хранилище (${storedSize}) не совпал с заявленным (${sizeBytes}) — похоже, загрузка оборвалась`,
      },
      { status: 422 }
    );
  }

  const { error: insertError } = await supabase
    .from("session_recording_chunks")
    .upsert(
      {
        session_id: sessionId,
        recording_attempt_id: attemptId,
        track,
        sequence,
        storage_key: storageKey,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        checksum,
        started_at_ms: Math.round(startedAtMs as number),
        duration_ms: Math.round(durationMs as number),
      },
      { onConflict: "recording_attempt_id,track,sequence" }
    );
  if (insertError) {
    return NextResponse.json({ error: `Не удалось записать метаданные фрагмента: ${insertError.message}` }, { status: 500 });
  }

  const nowIso = new Date().toISOString();

  if (session.recording_status === "none" || session.recording_status === null) {
    await supabase
      .from("sessions")
      .update({ recording_status: "recording", recording_heartbeat_at: nowIso })
      .eq("id", sessionId);
  } else if (session.recording_status === "uploading") {
    // Поздняя дозагрузка после manifest, отправленного с неподтверждённой
    // остановкой (см. claude/recording-stop-fix-plan.md и
    // .../recording/manifest/route.ts). Пересчитываем ТОЛЬКО ту дорожку,
    // к которой относится этот фрагмент, и ТОЛЬКО если сохранённый
    // manifest реально принадлежит ЭТОЙ попытке — иначе более старая/
    // другая попытка той же сессии могла бы перезаписать чужой результат.
    const storedManifest = session.recording_manifest as
      | { attemptId?: string | null; finishedAt?: string; validation?: TrackValidation[] }
      | null;
    const trackValidation = storedManifest?.validation?.find(v => v.role === track);

    if (storedManifest?.attemptId === attemptId && trackValidation?.unresolved) {
      const recomputed = await checkUnresolvedTrack(supabase, sessionId, attemptId, track, storedManifest.finishedAt);
      const mergedValidations = (storedManifest.validation ?? []).map(v =>
        v.role === track ? { role: recomputed.role, ok: recomputed.ok, reason: recomputed.reason, unresolved: recomputed.unresolved } : v
      );
      const finalStatus = computeFinalStatus(mergedValidations);

      // Лёгкий CAS тем же токеном, что и manifest-роут (см. его
      // заголовок) — лучшим усилием: если кто-то другой (ещё один
      // конкурентный confirm, либо сам manifest-роут) успел записать
      // между нашим чтением session в начале этого запроса и этой
      // записью, просто пропускаем — следующий confirm этой же дорожки
      // (если будет) пересчитает заново по уже свежим данным.
      const casQuery = supabase
        .from("sessions")
        .update({
          recording_status: finalStatus,
          recording_manifest: { ...storedManifest, validation: mergedValidations },
          recording_heartbeat_at: nowIso,
        })
        .eq("id", sessionId);
      await (session.recording_heartbeat_at === null
        ? casQuery.is("recording_heartbeat_at", null)
        : casQuery.eq("recording_heartbeat_at", session.recording_heartbeat_at));
    } else {
      await supabase.from("sessions").update({ recording_heartbeat_at: nowIso }).eq("id", sessionId);
    }
  } else {
    await supabase.from("sessions").update({ recording_heartbeat_at: nowIso }).eq("id", sessionId);
  }

  return NextResponse.json({ ok: true, track, sequence });
}
