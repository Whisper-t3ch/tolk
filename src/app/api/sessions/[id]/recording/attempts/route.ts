import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/sessions/[id]/recording/attempts
//
// НОВОЕ 24.09.2026, часть закрытия проблемы "коллизия байтов в Storage
// до JSON-подтверждения" (см. migration_038_recording_attempt_id.sql).
// Один вызов = один "заход" записи: ChunkUploader (src/lib/recording/
// uploader.ts) зовёт этот route РОВНО ОДИН РАЗ за своё существование
// (лениво, при первой реальной необходимости выгрузить фрагмент — см.
// ChunkUploader.ensureAttempt()), кэширует id и переиспользует его для
// ВСЕХ фрагментов обеих дорожек этого захода. ChunkUploader создаётся
// заново при каждом монтировании JitsiCallView — то есть при
// перезагрузке вкладки психолога посреди записи здесь неизбежно будет
// НОВЫЙ вызов → новый attempt_id → новый префикс пути объекта. Именно
// это делает коллизию путей между "старой" и "новой" попыткой
// структурно невозможной, а не просто пойманной постфактум на confirm
// (как было в первой версии идемпотентной проверки, см. её
// комментарий про то, что байты в Storage к моменту той проверки уже
// могли быть перезаписаны).
//
// attempt_id генерируется СЕРВЕРОМ (gen_random_uuid() в БД) — клиент
// никогда не присылает и не выбирает его сам, только получает в ответе
// и дальше подставляет в authorize/confirm запросы как есть.
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

  // Прежние активные попытки этой же сессии — 'superseded'. Это чисто
  // информационное поле для будущей уборки осиротевших объектов
  // (см. открытый вопрос в architecture-spec про несколько попыток на
  // одну консультацию) — оно НЕ даёт и не отнимает никаких прав, поэтому
  // если этот update по какой-то причине не выполнится, ничего не
  // ломается, отдельно не проверяем результат.
  await supabase
    .from("recording_attempts")
    .update({ status: "superseded", ended_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .eq("status", "active");

  const { data: attempt, error: insertError } = await supabase
    .from("recording_attempts")
    .insert({ session_id: sessionId, created_by: user.id })
    .select("id")
    .single();
  if (insertError || !attempt) {
    return NextResponse.json(
      { error: `Не удалось создать попытку записи: ${insertError?.message ?? "unknown error"}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, attemptId: attempt.id });
}
