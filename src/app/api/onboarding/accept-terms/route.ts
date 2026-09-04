import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/onboarding/accept-terms
// Body: {} (без параметров — версия оферты фиксирована на сервере)
//
// Вызывается сразу после успешного supabase.auth.signUp() на странице
// регистрации, до редиректа в кабинет — фиксирует факт согласия
// психолога с офертой и обработкой персональных данных (ФЗ-152).
//
// Строка в psychologists для нового пользователя создаётся отдельным
// Supabase DB trigger (on auth.users insert), не этим кодом — между
// успешным signUp() и срабатыванием триггера возможна гонка (несколько
// сотен мс). Делаем несколько попыток UPDATE с паузой вместо того, чтобы
// падать сразу: это юридически значимый факт, терять его из-за гонки
// недопустимо.
const TERMS_VERSION = "v1";
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 400;

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const acceptedAt = new Date().toISOString();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data, error } = await supabase
      .from("psychologists")
      .update({ terms_accepted_at: acceptedAt, terms_version: TERMS_VERSION })
      .eq("id", user.id)
      .select("id")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (data) {
      return NextResponse.json({ ok: true, terms_accepted_at: acceptedAt, terms_version: TERMS_VERSION });
    }

    // Строка ещё не создана DB-триггером — подождать и попробовать снова.
    if (attempt < MAX_ATTEMPTS) {
      await delay(RETRY_DELAY_MS);
    }
  }

  return NextResponse.json(
    {
      error:
        "Не удалось зафиксировать согласие — профиль психолога ещё не создан на сервере. Попробуйте обновить страницу через несколько секунд.",
    },
    { status: 503 }
  );
}
