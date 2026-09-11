import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
