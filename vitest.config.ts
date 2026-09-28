import { defineConfig } from "vitest/config";
import path from "node:path";

// Минимальный конфиг: единственная причина существования — научить
// vitest тому же алиасу "@/*" -> "src/*", что уже есть в tsconfig.json
// (paths) и который использует Next.js во время сборки. Без этого
// импорты вида "@/lib/supabase/client" в исходниках (не только в
// тестах) не резолвятся под vitest. Никаких других настроек намеренно
// не добавлено — тестовый раннер в проекте появился только 27.09.2026
// (см. claude/jitsi-pilot-test-report-27-09.md), минимальный конфиг.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
