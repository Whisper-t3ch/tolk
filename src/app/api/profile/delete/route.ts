import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/security/rateLimit";

const BUCKET = "session-recordings";
const CONFIRM_WORD = "УДАЛИТЬ";

// POST /api/profile/delete { password, confirm: "УДАЛИТЬ" }
// Необратимое удаление аккаунта психолога со всеми данными: клиенты, сессии, транскрипты, заметки, файлы записей.
// Защита: действующая сессия + пароль + слово подтверждения + лимит попыток. Сначала удаляются файлы записей из
// хранилища (если не вышло — БД не трогаем, чтобы не оставить «осиротевшие» файлы), затем SQL-функция delete_account.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const rl = rateLimit(`delete-account:${user.id}`, 5, 10 * 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Слишком много попыток. Попробуйте позже." }, { status: 429 });

  let body: { password?: string; confirm?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  if ((body.confirm ?? "").trim().toUpperCase() !== CONFIRM_WORD) {
    return NextResponse.json({ error: `Введите слово ${CONFIRM_WORD} для подтверждения` }, { status: 400 });
  }
  if (!body.password) return NextResponse.json({ error: "Введите пароль" }, { status: 400 });

  // Проверка пароля отдельным клиентом без сохранения сессии.
  const check = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: pwError } = await check.auth.signInWithPassword({ email: user.email, password: body.password });
  if (pwError) return NextResponse.json({ error: "Неверный пароль" }, { status: 403 });
  await check.auth.signOut().catch(() => undefined);

  const admin = createAdminClient();

  // 1. Файлы записей консультаций (ключ начинается с id сессии).
  try {
    const { data: sessions, error: sErr } = await admin.from("sessions").select("id").eq("psychologist_id", user.id).limit(20000);
    if (sErr) throw sErr;
    const ids = (sessions ?? []).map(s => s.id as string);
    const keys: string[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data: chunks, error: cErr } = await admin
        .from("session_recording_chunks")
        .select("storage_key")
        .in("session_id", ids.slice(i, i + 200))
        .limit(50000);
      if (cErr) throw cErr;
      for (const c of chunks ?? []) keys.push(c.storage_key as string);
    }
    for (let i = 0; i < keys.length; i += 100) {
      const { error: rErr } = await admin.storage.from(BUCKET).remove(keys.slice(i, i + 100));
      if (rErr) throw rErr;
    }
  } catch (e) {
    console.error("ACCOUNT_DELETE_STORAGE_FAILED", user.id, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Не удалось удалить файлы записей. Аккаунт не тронут — попробуйте ещё раз или напишите в «Помощь»." }, { status: 502 });
  }

  // 2. Данные в БД и сам аккаунт.
  const { error: delError } = await admin.rpc("delete_account", { p_uid: user.id });
  if (delError) {
    console.error("ACCOUNT_DELETE_FAILED", user.id, delError.message);
    const missing = /delete_account|PGRST202|schema cache/i.test(delError.message);
    return NextResponse.json(
      { error: missing ? "Удаление пока недоступно — напишите в «Помощь»." : "Не удалось удалить аккаунт. Напишите в «Помощь» — удалим вручную." },
      { status: 500 }
    );
  }
  console.log("ACCOUNT_DELETED", user.id);
  return NextResponse.json({ ok: true });
}
