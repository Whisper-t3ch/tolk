import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateTrack, computeFinalStatus, type TrackValidation } from "@/lib/recording/manifestValidation";

// POST /api/sessions/[id]/recording/manifest
// Body: RecordingManifest (src/lib/recording/types.ts) — отправляется
// один раз из JitsiCallView после SessionRecorder.stop(), когда
// консультация завершена и обе дорожки точно дописаны (или явно не
// подтвердили остановку — см. ниже).
//
// Это последняя проверка целостности перед тем, как сессия сможет
// уйти в ASR (Этап 3, ещё не построен): по каждой дорожке сверяем, что
// в session_recording_chunks реально лежит столько же фрагментов,
// сколько заявил browser, без дыр в нумерации и с тем же диапазоном
// sequence. Chunks-роут уже проверил checksum на входе каждого
// фрагмента — здесь пересчитывать его не нужно, достаточно убедиться,
// что "все номера на месте, нет дублей" (архитектурный документ,
// раздел "Manifest сессии"). Сама сверка живёт в manifestValidation.ts
// — общая с confirm-роутом (см. .../recording/chunks/route.ts),
// который пересчитывает статус ПОЗЖЕ, по мере дозагрузки.
//
// ИЗМЕНЕНО 25.09.2026 (см. claude/recording-stop-fix-plan.md в
// проекте, живой тест обнаружил, что TrackRecorder.stop() мог
// репортировать "остановлено", когда MediaRecorder реально продолжал
// писать): track.state==="failed" в manifest означает, что браузер САМ
// не смог подтвердить факт остановки этой дорожки (см. trackRecorder.ts)
// — в этом случае сверка по заявленному chunkCount не проводится
// (число заведомо ненадёжно), дорожка помечается unresolved, а не
// сразу "битой". Итоговый статус — trёхвариантный:
//   'processing' — все дорожки сошлись с реестром. Готово к ASR.
//   'uploading'  — хотя бы одна дорожка unresolved (остановка не
//                  подтверждена или фрагменты ещё летят), но явных
//                  доказательств потери данных нет. Confirm-роут
//                  досчитает статус позже, по мере дозагрузки этой же
//                  попытки (см. UNRESOLVED_GRACE_MS в
//                  manifestValidation.ts — по его истечении это же
//                  расхождение станет либо 'processing', либо
//                  'incomplete', в зависимости от того, нашлась ли
//                  дыра в реестре).
//   'incomplete' — хотя бы одна дорожка разошлась с реестром
//                  доказанно (дыра в нумерации, дорожка не
//                  записывалась) — само не исчезнет.
//
// ЗАЩИТА ОТ ГОНКИ с confirm-роутом (оба route.ts пишут в одни и те же
// sessions.recording_status/recording_manifest для одной сессии):
// используем recording_heartbeat_at как лёгкий optimistic-lock токен
// (compare-and-swap) — читаем его перед вычислением, пишем результат
// условно (WHERE recording_heartbeat_at = <прочитанное>), и если
// UPDATE не задел ни одной строки (кто-то другой успел записать между
// нашим чтением и записью — например, confirm-роут дозагрузки), просто
// перечитываем токен и повторяем попытку (до MAX_CAS_ATTEMPTS раз).
// Никакой новой миграции/функции в БД для этого не нужно — колонка уже
// существует и и так обновляется обоими route.ts при каждой записи.
interface ManifestTrack {
  role: "psychologist" | "client";
  mimeType: string | null;
  firstSequence: number;
  lastSequence: number;
  chunkCount: number;
  totalDurationMs: number;
  state: string;
}

interface ManifestBody {
  sessionId?: string;
  startedAt?: string;
  finishedAt?: string;
  /**
   * recording_attempt_id этой попытки (см. migration_038_recording_
   * attempt_id.sql) — ChunkUploader.sendManifest() подставляет его из
   * своего закэшированного attemptId. null только если за всю попытку
   * не выгрузили ни одного фрагмента (тогда фильтр по attempt_id в
   * validateTrack не применяется).
   */
  attemptId?: string | null;
  tracks?: ManifestTrack[];
}

const MAX_CAS_ATTEMPTS = 3;

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
    .select("id, recording_heartbeat_at")
    .eq("id", sessionId)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }

  let body: ManifestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  if (!Array.isArray(body.tracks) || body.tracks.length === 0) {
    return NextResponse.json({ error: "tracks обязателен и не может быть пустым" }, { status: 400 });
  }

  const attemptId = body.attemptId ?? null;
  const validations: TrackValidation[] = await Promise.all(
    body.tracks.map(track => validateTrack(supabase, sessionId, attemptId, track))
  );
  const finalStatus = computeFinalStatus(validations);
  const manifestToStore = { ...body, validation: validations };

  let casToken = session.recording_heartbeat_at as string | null;
  let updated = false;
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS && !updated; attempt++) {
    const nowIso = new Date().toISOString();
    let query = supabase
      .from("sessions")
      .update({
        recording_status: finalStatus,
        recording_manifest: manifestToStore,
        recording_heartbeat_at: nowIso,
      })
      .eq("id", sessionId);
    query = casToken === null ? query.is("recording_heartbeat_at", null) : query.eq("recording_heartbeat_at", casToken);

    const { data: updatedRows, error: updateError } = await query.select("id");
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    if (updatedRows && updatedRows.length > 0) {
      updated = true;
      break;
    }
    // CAS не сработал — кто-то (обычно confirm-роут дозагрузки того же
    // attempt_id) записал между нашим чтением и попыткой записи.
    // Перечитываем токен и пробуем ещё раз; сами validations пересчитывать
    // не нужно — они не зависят от того, что менялось в recording_status
    // между попытками (тот, кто выиграл гонку, тоже писал по актуальным
    // на СВОЙ момент данным).
    const { data: refreshed } = await supabase
      .from("sessions")
      .select("recording_heartbeat_at")
      .eq("id", sessionId)
      .maybeSingle();
    casToken = (refreshed?.recording_heartbeat_at as string | null) ?? null;
  }

  if (!updated) {
    // Исчерпали попытки CAS (редкая, но не невозможная гонка) — manifest
    // это итоговая, "последняя" операция для этой попытки записи с точки
    // зрения клиента, терять её молча хуже, чем один раз перезаписать
    // безусловно поверх того, что там оказалось.
    const { error: forcedError } = await supabase
      .from("sessions")
      .update({
        recording_status: finalStatus,
        recording_manifest: manifestToStore,
        recording_heartbeat_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
    if (forcedError) {
      return NextResponse.json({ error: forcedError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, status: finalStatus, validation: validations });
}
