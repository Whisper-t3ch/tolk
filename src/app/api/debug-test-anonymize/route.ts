import { NextResponse } from "next/server";
import { anonymizeTranscript } from "@/lib/anonymize";

// GET /api/debug-test-anonymize
// ВРЕМЕННЫЙ диагностический route — проверяет, что anonymizeTranscript
// реально заменяет персональные данные третьих лиц через YandexGPT lite.
// Удалить после проверки: без авторизации, не должен оставаться в проде.
export async function GET() {
  const testText =
    "Анна рассказала, что на прошлой неделе, 15 марта, у неё был конфликт с мужем Игорем. Он повысил на неё голос после того, как она вернулась поздно с встречи в Сбербанке, где обсуждали её перевод в другой отдел. Анна плакала весь вечер и не могла уснуть.";

  const anonymized = await anonymizeTranscript(testText, "Анна");

  const checks = {
    "Анна осталась как есть": anonymized.includes("Анна"),
    "Игорь заменён (не встречается)": !anonymized.includes("Игорь"),
    "15 марта заменено (не встречается)": !anonymized.includes("15 марта"),
    "Сбербанк заменён (не встречается)": !anonymized.includes("Сбербанк"),
  };
  const allPass = Object.values(checks).every(Boolean);

  return NextResponse.json({
    original: testText,
    anonymized,
    checks,
    result: allPass ? "PASS" : "FAIL",
  });
}
