import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, clientIp } from "@/lib/security/rateLimit";

// POST /api/public/register { name, email, password, code }
// Закрытая бета: регистрация только по инвайт-коду. Открытая регистрация в самом Supabase
// отключена (GOTRUE_DISABLE_SIGNUP=true), аккаунт создаёт только этот роут через service role.
// Код списывается атомарно (consume_invite_code); если создание аккаунта не удалось — возвращается.

export async function POST(request: NextRequest) {
  const rl = rateLimit(`register:${clientIp(request.headers)}`, 8, 10 * 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Слишком много попыток. Попробуйте позже." }, { status: 429 });

  let body: { name?: string; email?: string; password?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const name = body.name?.trim() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  const code = body.code?.trim() ?? "";

  if (!name) return NextResponse.json({ error: "Укажите имя" }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return NextResponse.json({ error: "Некорректный email" }, { status: 400 });
  if (password.length < 6 || password.length > 200) return NextResponse.json({ error: "Пароль слишком короткий (минимум 6 символов)" }, { status: 400 });
  if (!code || code.length > 100) return NextResponse.json({ error: "Введите инвайт-код" }, { status: 400 });

  const db = createAdminClient();
  const { data: ok, error: codeErr } = await db.rpc("consume_invite_code", { p_code: code });
  if (codeErr) return NextResponse.json({ error: "Не удалось проверить код. Попробуйте позже." }, { status: 500 });
  if (!ok) return NextResponse.json({ error: "Инвайт-код неверный, закончился или истёк" }, { status: 403 });

  const { error: createErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: name.slice(0, 120) },
  });
  if (createErr) {
    await db.rpc("release_invite_code", { p_code: code });
    const exists = /already|registered|exists/i.test(createErr.message);
    return NextResponse.json(
      { error: exists ? "Этот email уже зарегистрирован — попробуйте войти" : "Не удалось создать аккаунт. Попробуйте ещё раз." },
      { status: exists ? 409 : 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
