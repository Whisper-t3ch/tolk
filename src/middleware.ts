import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Пути, доступные без авторизации
const PUBLIC_PATHS = ["/", "/login"];
// Префиксы, доступные без авторизации целиком (публичная страница
// бронирования /book/[slug] — её открывают клиенты психолога, у
// которых нет и не будет аккаунта; /api/public/* — её backend).
const PUBLIC_PATH_PREFIXES = ["/book/", "/api/public/"];

/**
 * Middleware выполняется на каждый запрос: обновляет сессию Supabase
 * (обновляет истёкший access token через refresh token, если нужно)
 * и защищает приватные роуты — неавторизованных редиректит на /login.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic =
    PUBLIC_PATHS.some((p) => path === p) ||
    PUBLIC_PATH_PREFIXES.some((p) => path.startsWith(p)) ||
    path.startsWith("/_next") ||
    path.startsWith("/images");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Уже авторизованный пользователь не должен видеть форму входа заново
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Применяем middleware ко всем путям, кроме статики и служебных файлов Next.js
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
