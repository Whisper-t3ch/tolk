import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Прокси браузерного клиента Supabase к базе и хранилищу. Токен сессии лежит в HttpOnly-куке и
// страницам недоступен: сервер подставляет его сам. Доступны только данные (PostgREST) и хранилище;
// авторизация (/auth/v1) через прокси не ходит, для неё есть /api/auth/*.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALLOWED_PREFIXES = ["rest/v1/", "storage/v1/"];
const DROP_REQUEST = new Set(["host", "cookie", "connection", "content-length", "accept-encoding", "authorization", "x-tolk-proxy", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip"]);
const DROP_RESPONSE = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie"]);

function supabaseBase(): string {
  return (process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
}

async function handle(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const sub = (await params).path.join("/");
  if (!ALLOWED_PREFIXES.some(p => sub.startsWith(p)) || sub.includes("..")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Заголовок, который нельзя поставить с чужого сайта без CORS: защита от подделки запросов.
  if (request.headers.get("x-tolk-proxy") !== "1") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const base = supabaseBase();
  if (!base) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ message: "Не авторизован", error: "Unauthorized" }, { status: 401 });
  }

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!DROP_REQUEST.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("authorization", `Bearer ${session.access_token}`);
  headers.set("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(`${base}/${sub}${request.nextUrl.search}`, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: "manual",
      // @ts-expect-error duplex нужен Node для потоковой передачи тела запроса
      duplex: hasBody ? "half" : undefined,
    });
  } catch {
    return NextResponse.json({ error: "База недоступна" }, { status: 502 });
  }

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!DROP_RESPONSE.has(key.toLowerCase())) out.set(key, value);
  });
  out.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE, handle as HEAD };
