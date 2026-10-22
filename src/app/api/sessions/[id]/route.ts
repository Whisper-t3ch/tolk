import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "session-recordings";

// DELETE /api/sessions/[id] — удалить сессию психолога вместе с её данными (расшифровка, протокол, записи).
// Нужно, например, чтобы убрать дубль, созданный при повторной загрузке встречи. Необратимо: подтверждение на клиенте.
// Владение проверяется под RLS-клиентом; удаление связанных строк — SQL-функция _purge_rows (service role),
// файлы записей сначала удаляются из хранилища: не вышло — БД не трогаем.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { data: session, error: sErr } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", id)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
  if (!session) return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });

  const admin = createAdminClient();
  try {
    const { data: chunks, error: cErr } = await admin
      .from("session_recording_chunks")
      .select("storage_key")
      .eq("session_id", id)
      .limit(20000);
    if (cErr) throw cErr;
    const keys = (chunks ?? []).map(c => c.storage_key as string);
    for (let i = 0; i < keys.length; i += 100) {
      const { error: rErr } = await admin.storage.from(BUCKET).remove(keys.slice(i, i + 100));
      if (rErr) throw rErr;
    }
  } catch (e) {
    console.error("SESSION_DELETE_STORAGE_FAILED", id, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Не удалось удалить файлы записи. Сессия не тронута, попробуйте ещё раз." }, { status: 502 });
  }

  const { error: delError } = await admin.rpc("_purge_rows", { rel: "public.sessions", col: "id", val: id });
  if (delError) {
    console.error("SESSION_DELETE_FAILED", id, delError.message);
    return NextResponse.json({ error: "Не удалось удалить сессию. Напишите в «Помощь»." }, { status: 500 });
  }
  console.log("SESSION_DELETED", id);
  return NextResponse.json({ ok: true });
}
