import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Пути, доступные без авторизации
const PUBLIC_PATHS = ["/", "/login"];
// Префиксы, доступные без авторизации целиком — их открывают клиенты
// психолога, у которых нет и не будет аккаунта, либо внешние сервисы,
// у которых физически не может быть cookie-сессии психолога:
//   /book/[slug]         — публичная запись на консультацию,
//   /test/[token]        — прохождение назначенной методики по ссылке,
//   /join/[token]        — клиент подключается к сессии по инвайт-ссылке
//                          (consent-экран перед звонком, без аккаунта),
//   /api/public/*        — backend для booking + test,
//   /api/join/*          — backend для /join/[token] (resolve токена,
//                          consent / одноразовое потребление токена),
//   /api/webhooks/*      — входящие вебхуки Telegram/VK и записи звонков.
// Без последнего пункта Telegram получал 307 редирект на /login на КАЖДОЕ
// входящее сообщение (это не HTTP 200, Telegram считает доставку неуспешной
// и просто копит апдейты в очереди) — сообщения от клиентов никогда не
// доходили до обработчика вебхука, вне зависимости от того, куда указывает
// NEXT_PUBLIC_APP_URL. Подлинность вебхуков проверяется не сессией psychологa,
// а секретом в самом обработчике (webhook_secret / подписью), так что
// пропускать эти пути мимо auth-редиректа безопасно. Аналогично invite-токен
// в /join/[token] и /api/join/* сам по себе служит доказательством права
// доступа (одноразовый, с TTL, хэшированный в БД) — отдельная сессия
// психолога для этих путей не нужна и не ожидается.
const PUBLIC_PATH_PREFIXES = ["/book/", "/test/", "/join/", "/api/public/", "/api/join/", "/api/webhooks/"];

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
