import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/profile
// Возвращает имя психолога для персонализации UI (например заголовок
// дашборда "Добрый день, {name}"). Имя сохраняется в user_metadata при
// регистрации (см. src/app/login/page.tsx, signUp({ options: { data: { name } } })),
// отдельной колонки в psychologists для этого нет. Если имени почему-то
// нет (например аккаунт создан иначе) — отдаём часть email до "@" как
// разумный fallback вместо пустой строки.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const metadataName = typeof user.user_metadata?.name === "string" ? user.user_metadata.name.trim() : "";
  const fallbackName = user.email ? user.email.split("@")[0] : "Коллега";
  const name = metadataName || fallbackName;

  return NextResponse.json({ name, email: user.email ?? null });
}
