import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extensionForMimeType } from "@/lib/recording/mime";

// POST /api/sessions/[id]/recording/chunks
//
// ИЗМЕНЕНО 24.09.2026: раньше это был единственный шаг — сюда шёл
// multipart/form-data с самим Blob фрагмента, route handler сам грузил
// байты в Storage. Теперь это ВТОРОЙ шаг ("confirm") двухшаговой
// схемы прямой загрузки:
//   1. POST .../chunks/authorize — сервер выдаёт подписанный токен на
//      конкретный путь (без байт, см. тот route).
//   2. Браузер сам грузит Blob напрямую в Supabase Storage через
//      uploadToSignedUrl (см. uploader.ts) — Vercel байты не видит.
//   3. Этот route — маленький JSON-запрос с метаданными фрагмента,
//      подтверждающий, что шаг 2 реально прошёл, и записывающий строку
//      в session_recording_chunks.
//
// Контракт с браузером (см. src/lib/recording/uploader.ts,
// uploadOnce()) сознательно несовместим со старым multipart-контрактом
// — это ломающее изменение API, но оправданное: пайплайн записи ни
// разу не был живым (0 строк в session_recording_chunks на 24.09), так
// что совместимость поддерживать не с чем.
//
// ЧЕСТНАЯ ОГОВОРКА ПРО ЦЕЛОСТНОСТЬ (регрессия, не скрывать, checksum —
// UNVERIFIED до Этапа 3): раньше сервер сам считал sha256 от реальных
// байт ДО того, как положить их в Storage, и мог гарантированно
// отвергнуть повреждённый фрагмент. Тут сервер байт не видит вообще —
// checksum, который присылает браузер, сервером НЕ пересчитывается и
// НЕ может быть пересчитан без скачивания объекта обратно (что снова
// означало бы прогонять байты через Vercel и убивало бы весь смысл
// прямой загрузки). Вместо этого здесь проверяется только то, что
// объект действительно существует в Storage по заявленному пути и что
// его реальный размер (из Storage API, не от браузера) совпадает с
// заявленным — это ловит случай "клиент соврал про confirm, а
// загрузки не было" или "загрузка оборвалась на середине", но НЕ
// ловит побитово повреждённый, но правильного размера файл.
// `session_recording_chunks.checksum` в этом состоянии — заявленное
// браузером значение, НЕ криптографически подтверждённое сервером.
// НИКАКОЙ код (UI психолога, будущий Этап 3/STT, отчёты) не должен
// трактовать его как гарантию целостности, пока байты не будут реально
// прочитаны и хешированы — это произойдёт на этапе сборки дорожки
// перед GigaAM (Этап 3, ещё не реализован), там байты и так придётся
// скачивать целиком, это и есть правильное место для сильной проверки.
//
// ИДЕМПОТЕНТНОСТЬ (явная политика, добавлено 24.09 по итогам ревью):
//   - Повтор ТОГО ЖЕ фрагмента (сеть моргнула до того, как браузер
//     получил ответ confirm, retry шлёт тот же checksum) — БЕЗОПАСНО:
//     upsert перезаписывает строку тем же содержимым, эффект
//     идемпотентен, данные не теряются.
//   - Confirm с ДРУГИМ checksum на тот же (session_id, track, sequence)
//     — это НЕ обычный retry, а коллизия: два разных по содержимому
//     фрагмента претендуют на один и тот же ключ (реалистичный сценарий
//     — психолог перезагрузил вкладку посреди консультации, новый
//     SessionRecorder начал нумерацию заново с sequence=0 для того же
//     session_id, см. известное ограничение в chunkStore.ts). Такой
//     confirm ОТКЛОНЯЕТСЯ (409), а не тихо перезаписывает строку —
//     см. проверку ниже. ВАЖНО, честно: к моменту этой проверки Blob
//     нового фрагмента уже физически лежит в Storage поверх старого
//     (upsert:true на signed URL в authorize действует раньше, на
//     шаге 2, до того как сервер вообще увидит этот confirm) — эта
//     проверка не может предотвратить перезапись байт в Storage, она
//     только не даёт БД молча соврать, что всё сошлось, и явно
//     сигнализирует о коллизии вызывающему коду. Настоящее устранение
//     этого класса коллизий требует привязки пути объекта к
//     идентификатору попытки записи (recording attempt id), а не к
//     голому sequence — это отдельная, более крупная задача
//     (затрагивает schema/storage key format), не делалась здесь,
//     чтобы не менять архитектуру без вашего решения; см. описание в
//     архитектурном документе.
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

  let body: {
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

  const { track, sequence, startedAtMs, durationMs, checksum, mimeType, sizeBytes } = body;

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

  // Идемпотентность: если строка на (session_id, track, sequence) уже
  // есть и её checksum ОТЛИЧАЕТСЯ от присланного — это коллизия
  // (разные данные, один ключ), не обычный retry. Отклоняем явно, не
  // даём upsert'у тихо подменить уже подтверждённый фрагмент другим.
  // См. честную оговорку в комментарии к route выше о том, что байты
  // в Storage к этому моменту уже могли быть перезаписаны — эта
  // проверка ловит расхождение на уровне БД/API-ответа, не откатывает
  // Storage.
  const { data: existing, error: existingError } = await supabase
    .from("session_recording_chunks")
    .select("checksum")
    .eq("session_id", sessionId)
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
          "Коллизия: для этого (track, sequence) уже подтверждён фрагмент с ДРУГИМ содержимым (другой checksum). " +
          "Это не безопасный повтор — вероятная причина: перезагрузка страницы посреди записи начала нумерацию " +
          "заново для того же session_id. Строка НЕ перезаписана автоматически.",
      },
      { status: 409 }
    );
  }

  const ext = extensionForMimeType(mimeType);
  const storageKey = `recordings/${sessionId}/${track}/${String(sequence).padStart(6, "0")}.${ext}`;
  const folder = `recordings/${sessionId}/${track}`;
  const filename = `${String(sequence).padStart(6, "0")}.${ext}`;

  // Единственная проверка, доступная серверу без скачивания байт:
  // объект реально лежит в Storage по этому пути, и его размер (из
  // Storage API, source of truth) совпадает с тем, что заявил браузер.
  // См. оговорку про целостность в комментарии к route выше.
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
        track,
        sequence,
        storage_key: storageKey,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        checksum,
        started_at_ms: Math.round(startedAtMs as number),
        duration_ms: Math.round(durationMs as number),
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
