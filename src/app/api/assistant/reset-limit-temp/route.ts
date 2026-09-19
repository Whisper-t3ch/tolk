// ============================================================
// ВРЕМЕННЫЙ служебный эндпоинт — только для сегодняшнего контролируемого
// сбора паттернов псевдо-tool-call на Pro 5.1 (задача #26), пока
// единственный пользователь прода — сам разработчик. Обнуляет
// assistant_requests_used ТОЛЬКО для авторизованного вызывающего (через
// обычную сессию Supabase, тот же auth.uid(), что и во всех остальных
// route.ts) — нельзя обнулить лимит чужого психолога, так как id берётся
// исключительно из собственной сессии запроса, не из параметра.
//
// УДАЛИТЬ этот файл сразу после завершения сбора данных — не оставлять
// в проде даже в этом узком виде дольше, чем нужно для сегодняшнего теста.
// ============================================================
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { error } = await supabase
    .from("psychologists")
    .update({ assistant_requests_used: 0 })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, reset_for: user.id });
}
