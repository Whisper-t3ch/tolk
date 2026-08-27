// ============================================================
// ТОЛК — временные демо-данные для страницы клиента (тесты/триггеры/ДЗ).
// Эта предметная область (результаты тестов, триггеры, прогресс) пока не
// перенесена в Supabase — см. комментарий в lib/data/clients.ts.
// Ключ — имя клиента (а не UUID), чтобы не зависеть от конкретных id
// в БД конкретного окружения. Используется только для демонстрации,
// пока реальное хранилище тестов не реализовано.
// ============================================================

export interface DemoClientExtras {
  triggers: string[];
  hwCompleted: number;
  hwTotal: number;
  lastTest: { name: string; score: number; maxScore: number; date: string };
  testHistory: Array<{ date: string; score: number }>;
}

export const demoClientExtrasByName: Record<string, DemoClientExtras> = {
  "Мария Соколова": {
    triggers: ["переработки", "дедлайны по вечерам", "невозможность отключиться от работы"],
    hwCompleted: 5,
    hwTotal: 8,
    lastTest: { name: "GAD-7", score: 10, maxScore: 21, date: "20 авг" },
    testHistory: [
      { date: "30 июл", score: 17 },
      { date: "6 авг", score: 14 },
      { date: "13 авг", score: 12 },
      { date: "20 авг", score: 10 },
    ],
  },
  "Дмитрий Волков": {
    triggers: ["критика от руководства", "отсутствие видимого результата труда", "сравнение с коллегами"],
    hwCompleted: 3,
    hwTotal: 6,
    lastTest: { name: "MBI (выгорание)", score: 34, maxScore: 66, date: "20 авг" },
    testHistory: [
      { date: "30 июл", score: 48 },
      { date: "6 авг", score: 43 },
      { date: "13 авг", score: 38 },
      { date: "20 авг", score: 34 },
    ],
  },
  "Анна Петрова": {
    triggers: ["ревность в отношениях", "молчание партнёра", "соцсети партнёра"],
    hwCompleted: 6,
    hwTotal: 7,
    lastTest: { name: "Индекс удовлетворённости отношениями", score: 62, maxScore: 100, date: "20 авг" },
    testHistory: [
      { date: "30 июл", score: 41 },
      { date: "6 авг", score: 48 },
      { date: "13 авг", score: 55 },
      { date: "20 авг", score: 62 },
    ],
  },
  "Игорь Смирнов": {
    triggers: ["звонки от бывших коллег", "поиск работы", "утренние часы без дел"],
    hwCompleted: 2,
    hwTotal: 6,
    lastTest: { name: "PHQ-9", score: 16, maxScore: 27, date: "20 авг" },
    testHistory: [
      { date: "30 июл", score: 21 },
      { date: "6 авг", score: 19 },
      { date: "13 авг", score: 18 },
      { date: "20 авг", score: 16 },
    ],
  },
  "Елена Кузнецова": {
    triggers: ["визиты к родителям", "детские фотографии", "разговоры о семье"],
    hwCompleted: 4,
    hwTotal: 5,
    lastTest: { name: "WHO-5", score: 48, maxScore: 100, date: "20 авг" },
    testHistory: [
      { date: "30 июл", score: 32 },
      { date: "6 авг", score: 38 },
      { date: "13 авг", score: 44 },
      { date: "20 авг", score: 48 },
    ],
  },
};
