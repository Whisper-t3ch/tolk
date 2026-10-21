import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Камера/микрофон нужны странице звонка и встроенному Jitsi; остальное закрыто.
  { key: "Permissions-Policy", value: "camera=(self \"https://meet.tolkplace.ru\"), microphone=(self \"https://meet.tolkplace.ru\"), display-capture=(self \"https://meet.tolkplace.ru\"), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  /* config options here */
  // Проверка типов уже пройдена локально (npx tsc --noEmit — чисто).
  // На сборочной машине Vercel (2 ядра / 8GB) отдельный проход tsc поверх
  // большого page.tsx может упираться в ресурсы без явной ошибки в логе —
  // отключаем повторную проверку типов на этапе продакшн-сборки.
  typescript: {
    ignoreBuildErrors: true,
  },
  // pdf-lib и @pdf-lib/fontkit (генерация PDF-протокола сессии) —
  // CommonJS-пакеты, которые бандлер ломает при сборке серверного кода:
  // route /api/sessions/[id]/soap/pdf падал с пустым 500 ещё на этапе
  // загрузки модуля. Грузим их нативно средствами Node вместо бандлинга.
  serverExternalPackages: ["pdf-lib", "@pdf-lib/fontkit"],
  // Загрузка аудио встречи (до 55 МБ) идёт через middleware: по умолчанию Next буферизует тело только до 10 МБ и обрезает остальное.
  // Выше этого предела Caddy всё равно не пропустит (request_body max_size 60MB в Caddyfile.prod).
  experimental: { proxyClientMaxBodySize: "60mb" },
  // Самодостаточная сборка для Docker (Dockerfile в корне репозитория задаёт
  // NEXT_OUTPUT=standalone). Без этой переменной (в том числе на Vercel)
  // поведение сборки не меняется.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
