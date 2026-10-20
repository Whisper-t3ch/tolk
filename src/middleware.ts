import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { rateLimit, clientIp } from "@/lib/security/rateLimit";

// Пути, доступные без авторизации
// /api/health — лёгкая проверка живости (Docker healthcheck, мониторинг), без БД и секретов.
const PUBLIC_PATHS = ["/", "/login", "/email-recovery.html", "/forgot-password", "/reset-password", "/api/health", "/privacy", "/terms", "/consent", "/client-consent"];
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
// /api/jobs/* — воркер очереди транскрипции (Vercel Cron / ручной вызов с
// `Authorization: Bearer ${CRON_SECRET}`). Cron и ручной запуск не имеют
// cookie-сессии психолога, поэтому без этого префикса middleware отдавал
// 307 на /login и до обработчика запрос не доходил. Авторизация — не
// сессией, а CRON_SECRET в самом обработчике (checkAuth): пока секрет не
// задан, любой запрос получает 401.
// /api/admin/* — служебные выгрузки владельца; авторизация внутри обработчика (Bearer SUPPORT_ADMIN_TOKEN или email из SUPPORT_ADMIN_EMAILS).
const PUBLIC_PATH_PREFIXES = ["/book/", "/test/", "/join/", "/api/public/", "/api/join/", "/api/webhooks/", "/api/jobs/", "/api/admin/"];

/**
 * Middleware выполняется на каждый запрос: обновляет сессию Supabase
 * (обновляет истёкший access token через refresh token, если нужно)
 * и защищает приватные роуты — неавторизованных редиректит на /login.
 */
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Лимиты на публичные API (без сессии): защита от перебора и мусорного трафика.
  // Вебхуки Telegram/VK и воркер не ограничиваем — у них свои секреты и частота.
  if (path.startsWith("/api/") && !path.startsWith("/api/webhooks/") && !path.startsWith("/api/jobs/") && path !== "/api/health") {
    const isPublicApi = path.startsWith("/api/public/") || path.startsWith("/api/join/");
    const ip = clientIp(request.headers);
    const rl = isPublicApi
      ? rateLimit(`pub:${ip}`, 90, 60_000)
      : request.method !== "GET"
        ? rateLimit(`mut:${ip}`, 240, 60_000)
        : rateLimit(`api:${ip}`, 600, 60_000);
    if (!rl.ok) {
      return new NextResponse(JSON.stringify({ error: "Слишком много запросов. Попробуйте позже." }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": String(rl.retryAfterSec) },
      });
    }
  }

  const isPublicPath =
    PUBLIC_PATHS.some((p) => path === p) ||
    PUBLIC_PATH_PREFIXES.some((p) => path.startsWith(p)) ||
    path.startsWith("/_next") ||
    path.startsWith("/images");

  // Публичные страницы (кроме /login) не зависят от сессии: не ходим за ней в Supabase
  // на каждый хит — иначе всплеск трафика на лендинг превращается в нагрузку на БД/auth.
  if (isPublicPath && path !== "/login") {
    return NextResponse.next({ request });
  }

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

  if (!user && !isPublicPath) {
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
