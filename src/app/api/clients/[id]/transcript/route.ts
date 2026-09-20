import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildJitsiRoomName } from "@/lib/jitsi";
import { saveSessionTranscript } from "@/lib/saveSessionTranscript";

// POST /api/clients/[id]/transcript
// Body: { text: string, date?: string /* YYYY-MM-DD, по умолчанию сегодня */ }
//
// Загрузка транскрипта прошлой встречи сразу при создании нового
// клиента — до этого эндпоинта единственный способ добавить транскрипт
// (api/sessions/[id]/transcript) требовал уже существующую сессию, а у
// только что созданного клиента сессий ещё нет вообще. Психолог,
// заводящий в системе клиента, с которым уже была одна или несколько
// встреч до подключения платформы, не мог занести их историю.
//
// Решение: создаём здесь одну "историческую" сессию сразу со
// status='completed' (встреча уже состоялась, это не будущая запись в
// расписание) на указанную дату (или на сегодня, если дата не передана),
// затем сохраняем текст через тот же пайплайн, что и обычная ручная
// загрузка (saveSessionTranscript — анонимизация → session_transcripts
// → чанкинг+embedding для RAG). duration_minutes не указываем осознанно
// (реальная длительность прошлой встречи неизвестна, NULL безопаснее
// произвольного значения).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { text?: string; date?: string };
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

  // Владение клиентом проверяем явно (не полагаемся только на RLS) — тот
  // же паттерн, что и в export/transcripts и session/[id]/transcript.
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (clientError) {
    return NextResponse.json({ error: clientError.message }, { status: 500 });
  }
  if (!client) {
    return NextResponse.json({ error: "Клиент не найден" }, { status: 404 });
  }

  // Дата — только календарный день, без конкретного времени встречи
  // (психолог обычно не помнит точное время прошлой сессии). Пишем
  // полдень UTC, чтобы дата не съехала на соседний день из-за смещения
  // часового пояса при последующем отображении.
  let scheduledAt: string;
  if (body.date) {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? new Date(`${body.date}T12:00:00.000Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Некорректная дата (ожидается YYYY-MM-DD)" }, { status: 400 });
    }
    if (parsed.getTime() > Date.now()) {
      return NextResponse.json({ error: "Дата прошедшей встречи не может быть в будущем" }, { status: 400 });
    }
    scheduledAt = parsed.toISOString();
  } else {
    scheduledAt = new Date().toISOString();
  }

  const sessionId = crypto.randomUUID();
  const { error: sessionError } = await supabase.from("sessions").insert({
    id: sessionId,
    psychologist_id: user.id,
    client_id: clientId,
    scheduled_at: scheduledAt,
    status: "completed",
    jitsi_room_name: buildJitsiRoomName(sessionId),
  });
  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }

  try {
    const { chunksTotal, chunksEmbedded } = await saveSessionTranscript(
      supabase,
      sessionId,
      (client.name as string) ?? "",
      text
    );
    return NextResponse.json({ ok: true, sessionId, embeddingSaved: chunksEmbedded > 0, chunksTotal, chunksEmbedded });
  } catch (e) {
    // Сессия уже создана — не откатываем её: транскрипт можно будет
    // дозагрузить вручную через сессию (api/sessions/[id]/transcript),
    // а пустая "историческая" сессия без транскрипта не мешает работе.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Сессия создана, но сохранить транскрипт не удалось", sessionId },
      { status: 500 }
    );
  }
}
