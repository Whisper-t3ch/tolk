import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extensionForMimeType } from "@/lib/recording/mime";

// POST /api/sessions/[id]/recording/chunks/authorize
//
// ПЕРЕРАБОТАНО 24.09.2026 по прямому требованию пользователя —
// закрывает конкретную проблему "коллизия байтов в Storage до JSON-
// подтверждения": прежняя идемпотентная проверка на confirm (409 при
// несовпадении checksum) защищала только строку в БД, а не физический
// объект — к моменту confirm-проверки Blob уже мог лежать в Storage
// поверх старого, потому что upsert:true на этом route разрешал
// перезапись БЕЗ КАКИХ-ЛИБО условий, а путь строился только из
// (session_id, track, sequence) — того же ключа, что заново начинался
// с нуля при каждой перезагрузке вкладки психолога.
//
// Два независимых изменения:
//
//   1) Путь объекта больше не (session_id, track, sequence), а
//      (session_id, recording_attempt_id, track, sequence) — см.
//      migration_038_recording_attempt_id.sql. attempt_id браузер
//      получает от .../recording/attempts (тоже новое, см. тот route)
//      и присылает сюда как есть; этот route НЕ генерирует его сам и
//      не принимает путь целиком от браузера — только сырые поля,
//      путь вычисляется здесь.
//
//   2) upsert:true выдаётся signed URL ТОЛЬКО если для этого
//      (attempt_id, track, sequence) ЕЩЁ НЕТ подтверждённой строки в
//      session_recording_chunks. Если строка УЖЕ подтверждена —
//      НИКАКОЙ новый токен не выдаётся вообще (ни с upsert, ни без) —
//      это и есть буквальное требование "нельзя выдавать новую
//      возможность записи по пути уже подтверждённого chunk". Вместо
//      токена возвращается alreadyConfirmed:true — ChunkUploader (см.
//      uploader.ts) интерпретирует это как "этот фрагмент уже
//      реально долетел в прошлый раз, просто ответ не дошёл до
//      браузера" и не делает upload/confirm заново, сразу считает
//      фрагмент выгруженным.
//
//      upsert:true для НЕ-подтверждённых путей осознанно оставлен —
//      это безопасный повтор незавершённой попытки (authorize прошёл,
//      upload прервался или confirm не дошёл) на путь, где ещё нет
//      подтверждённых данных, которые можно было бы испортить.
//      Технически это НЕ "upsert решает коллизию" (пользователь прав,
//      что предполагать это нельзя) — коллизию решает разделение
//      путей по attempt_id; upsert здесь остаётся только ради
//      идемпотентности retry ВНУТРИ одной ещё не подтверждённой
//      попытки записи одного и того же фрагмента, где перезапись
//      ничего ценного не уничтожает.
//
// Владение сессией по-прежнему проверяется обычным cookie-сессионным
// клиентом (createClient() из ./server.ts) ДО какого-либо обращения к
// admin-клиенту — см. комментарий в src/lib/supabase/admin.ts про то,
// почему здесь вообще появился service-role и что он НЕ закрывает сам
// по себе (RLS storage.objects всё ещё разрешает психологу писать в
// обход этого route напрямую — отдельный, пока не применённый пункт
// миграции).
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

  let body: { attemptId?: string; track?: string; sequence?: number; mimeType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const { attemptId, track, sequence, mimeType } = body;
  if (typeof attemptId !== "string" || !attemptId) {
    return NextResponse.json({ error: "attemptId обязателен" }, { status: 400 });
  }
  if (track !== "psychologist" && track !== "client") {
    return NextResponse.json({ error: "track должен быть 'psychologist' или 'client'" }, { status: 400 });
  }
  if (!Number.isInteger(sequence) || (sequence as number) < 0) {
    return NextResponse.json({ error: "sequence должен быть неотрицательным целым" }, { status: 400 });
  }
  if (typeof mimeType !== "string" || !mimeType) {
    return NextResponse.json({ error: "mimeType обязателен" }, { status: 400 });
  }

  // attemptId обязан принадлежать ЭТОЙ сессии — та же RLS-гарантия,
  // что действует в /recording/attempts на создании (own_recording_
  // attempts_select), проверяем явно здесь ещё раз, а не полагаемся
  // только на то, что клиент "честно" переслал то, что получил.
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
    return NextResponse.json(
      { error: "attemptId не найден для этой сессии — вызовите /recording/attempts заново" },
      { status: 404 }
    );
  }

  // Нельзя выдавать новую возможность записи по пути уже
  // подтверждённого chunk — ни с upsert, ни без. Если строка уже
  // есть, upload на самом деле не нужен: сигнализируем об этом вместо
  // токена.
  const { data: existingChunk, error: existingError } = await supabase
    .from("session_recording_chunks")
    .select("id")
    .eq("recording_attempt_id", attemptId)
    .eq("track", track)
    .eq("sequence", sequence)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (existingChunk) {
    return NextResponse.json({ ok: true, alreadyConfirmed: true });
  }

  const ext = extensionForMimeType(mimeType);
  const storageKey = `${sessionId}/${attemptId}/${track}/${String(sequence).padStart(6, "0")}.${ext}`;

  // service-role — ТОЛЬКО для этого вызова, ТОЛЬКО после владения и
  // "не подтверждён ли уже" проверенных выше через RLS-клиент. См.
  // комментарий в src/lib/supabase/admin.ts.
  const admin = createAdminClient();
  const { data, error } = await admin.storage
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
    alreadyConfirmed: false,
    path: data.path,
    token: data.token,
    signedUrl: data.signedUrl,
    storageKey,
  });
}
