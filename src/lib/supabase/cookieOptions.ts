import type { CookieOptions } from "@supabase/ssr";

/**
 * Куки сессии Supabase (sb-…-auth-token) ставятся только сервером и только HttpOnly:
 * JavaScript страницы их не видит, поэтому XSS не может украсть токен.
 * Браузерный клиент (lib/supabase/client.ts) работает через серверный прокси /api/sb.
 */
export function hardenCookieOptions(options?: CookieOptions): CookieOptions {
  return {
    ...options,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  };
}

/** Имя куки сессии (включая куски sb-…-auth-token.0, .1). Куку code-verifier не трогаем. */
export const AUTH_COOKIE_RE = /^sb-.+-auth-token(\.\d+)?$/;
