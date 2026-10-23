import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";

// POST /api/auth/forgot { email } — письмо для сброса пароля. Ссылка всегда ведёт на /reset-password нашего же домена.
export async function POST(request: NextRequest) {
  const rl = rateLimit(`forgot:${clientIp(request.headers)}`, 10, 60_000);
  if (!rl.ok) return NextResponse.json({ error: { message: "Too many requests", status: 429 } }, { status: 429 });
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { message: "Bad request", status: 400 } }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  if (!email) return NextResponse.json({ error: { message: "Bad request", status: 400 } }, { status: 400 });

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  const origin = appUrl || (host ? `${proto}://${host}` : request.nextUrl.origin);

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/reset-password` });
  if (error) return NextResponse.json({ error: { message: error.message, status: error.status ?? 400 } }, { status: error.status === 429 ? 429 : 400 });
  return NextResponse.json({ ok: true });
}
