import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// POST /api/sessions/[id]/recording/manifest
// Body: RecordingManifest (src/lib/recording/types.ts) — отправляется
// один раз из JitsiCallView после SessionRecorder.stop(), когда
// консультация завершена и обе дорожки точно дописаны.
//
// Это последняя проверка целостности перед тем, как сессия сможет
// уйти в ASR (Этап 3, ещё не построен): по каждой дорожке сверяем, что
// в session_recording_chunks реально лежит столько же фрагментов,
// сколько заявил browser, без дыр в нумерации и с тем же диапазоном
// sequence. Chunks-роут уже проверил checksum на входе каждого
// фрагмента — здесь пересчитывать его не нужно, достаточно убедиться,
// что "все номера на месте, нет дублей" (архитектурный документ,
// раздел "Manifest сессии").
//
// Результат — recording_status:
//   'processing'  — обе дорожки сошлись с реестром. Готово к ASR
//                    (когда Этап 3 появится); сейчас просто финальное
//                    состояние "запись цела".
//   'incomplete'  — хотя бы одна дорожка разошлась с manifest. Запись
//                    частично есть и её можно будет использовать (см.
//                    architecture-spec), но психолога нужно
//                    предупредить, что часть разговора отсутствует.
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
   * не выгрузили ни одного фрагмента (тогда фильтр по attempt_id ниже
   * не применяется — см. validateTrack).
   */
  attemptId?: string | null;
  tracks?: ManifestTrack[];
}

interface TrackValidation {
  role: string;
  ok: boolean;
  reason?: string;
}

async function validateTrack(
  supabase: SupabaseClient,
  sessionId: string,
  attemptId: string | null,
  track: ManifestTrack
): Promise<TrackValidation> {
  // ВАЖНО (24.09, вместе с migration_038): фильтр по recording_attempt_id
  // обязателен, если он известен. Без него при НЕСКОЛЬКИХ попытках
  // записи одной сессии (психолог перезагрузил вкладку) здесь бы
  // суммировались фрагменты из РАЗНЫХ попыток с независимой
  // нумерацией sequence с нуля в каждой — это выглядело бы как
  // "дубли"/"дыры в нумерации", хотя реально это просто две разные
  // попытки. attemptId=null (за всю попытку не выгружено ни одного
  // фрагмента) — единственный случай, когда фильтр опускается и
  // сверка идёт по всей сессии; в этом случае track.chunkCount по
  // manifest тоже 0, так что расхождение обнаружится, если в БД
  // внезапно НЕ 0 строк.
  let query = supabase
    .from("session_recording_chunks")
    .select("sequence")
    .eq("session_id", sessionId)
    .eq("track", track.role);
  if (attemptId) {
    query = query.eq("recording_attempt_id", attemptId);
  }
  const { data: rows, error } = await query.order("sequence", { ascending: true });

  if (error) {
    return { role: track.role, ok: false, reason: `Не удалось прочитать реестр фрагментов: ${error.message}` };
  }

  const sequences = (rows ?? []).map(r => r.sequence as number);
  const actualCount = sequences.length;

  if (track.chunkCount <= 0) {
    // Дорожка не писалась (например, клиент так и не подключился) —
    // это реальная проблема записи, но не проблема ЦЕЛОСТНОСТИ выгрузки
    // (нечего было терять). Помечаем отдельно, чтобы отличить от дыр.
    if (actualCount !== 0) {
      return {
        role: track.role,
        ok: false,
        reason: `manifest заявляет 0 фрагментов, но в реестре есть ${actualCount} — расхождение`,
      };
    }
    return { role: track.role, ok: false, reason: "дорожка не записывалась (0 фрагментов)" };
  }

  if (actualCount !== track.chunkCount) {
    return {
      role: track.role,
      ok: false,
      reason: `ожидалось ${track.chunkCount} фрагментов по manifest, в реестре ${actualCount}`,
    };
  }

  for (let i = 0; i < sequences.length; i++) {
    if (sequences[i] !== i) {
      return { role: track.role, ok: false, reason: `дыра в нумерации на позиции ${i} (sequence=${sequences[i]})` };
    }
  }

  if (sequences[0] !== track.firstSequence || sequences[sequences.length - 1] !== track.lastSequence) {
    return { role: track.role, ok: false, reason: "диапазон sequence не совпал с manifest" };
  }

  return { role: track.role, ok: true };
}

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
  const validations = await Promise.all(body.tracks.map(track => validateTrack(supabase, sessionId, attemptId, track)));
  const allOk = validations.every(v => v.ok);
  const finalStatus = allOk ? "processing" : "incomplete";

  const { error: updateError } = await supabase
    .from("sessions")
    .update({
      recording_status: finalStatus,
      recording_manifest: { ...body, validation: validations },
    })
    .eq("id", sessionId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: finalStatus, validation: validations });
}
