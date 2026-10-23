import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase-клиент для клиентских компонентов ("use client").
 *
 * Токен сессии браузер НЕ получает: он лежит в HttpOnly-куке `sb-…-auth-token`, которую ставит и читает
 * только сервер (XSS не может её украсть). Поэтому клиент ходит не в Supabase напрямую, а в наш
 * серверный прокси `/api/sb` (данные и хранилище), а методы входа/выхода/сброса пароля вызывают
 * серверные роуты `/api/auth/*`. Для кода страниц интерфейс остался прежним.
 */
type AuthError = { message: string; status?: number; name?: string };

async function post(path: string, body?: unknown): Promise<{ ok: boolean; error: AuthError | null }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: AuthError };
    if (res.ok) return { ok: true, error: null };
    return { ok: false, error: data.error ?? { message: `Ошибка ${res.status}`, status: res.status } };
  } catch {
    return { ok: false, error: { message: "Не удалось связаться с сервером", status: 0 } };
  }
}

async function currentUser(): Promise<{ id: string; email: string | null } | null> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { user?: { id: string; email: string | null } | null };
    return data.user ?? null;
  } catch {
    return null;
  }
}

function proxyBaseUrl(): string {
  const origin = typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${origin}/api/sb`;
}

function build() {
  const client = createSupabaseClient(proxyBaseUrl(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-tolk-proxy": "1" } },
  });

  const missing = (): AuthError => ({ message: "Auth session missing!", name: "AuthSessionMissingError", status: 400 });
  const auth = client.auth as unknown as Record<string, unknown>;

  auth.getUser = async () => {
    const user = await currentUser();
    return user ? { data: { user }, error: null } : { data: { user: null }, error: missing() };
  };
  auth.getSession = async () => {
    const user = await currentUser();
    return { data: { session: user ? { user } : null }, error: null };
  };
  auth.signInWithPassword = async (creds: { email: string; password: string }) => {
    const r = await post("/api/auth/login", creds);
    return { data: { user: null, session: null }, error: r.error };
  };
  auth.signOut = async () => {
    await post("/api/auth/logout");
    return { error: null };
  };
  auth.resetPasswordForEmail = async (email: string) => {
    const r = await post("/api/auth/forgot", { email });
    return { data: {}, error: r.error };
  };
  auth.exchangeCodeForSession = async (code: string) => {
    const r = await post("/api/auth/exchange", { code });
    return { data: { user: null, session: null }, error: r.error };
  };
  auth.updateUser = async (attrs: { password?: string }) => {
    const r = await post("/api/auth/update-password", { password: attrs.password });
    return { data: { user: null }, error: r.error };
  };
  return client;
}

let singleton: ReturnType<typeof build> | null = null;

export function createClient() {
  if (typeof window === "undefined") return build();
  return (singleton ??= build());
}
