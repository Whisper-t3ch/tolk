// ------------------------------------------------------------
// Шкалы психометрических тестов — максимальный балл и интерпретация
// диапазонов. Используется при создании test_results, чтобы каждой
// записи сразу присваивалась человекочитаемая интерпретация вместо
// голого числа.
// ------------------------------------------------------------
export type TestType = "PHQ9" | "GAD7" | "WHO5" | "PCL5" | "BDI";

interface ScaleRange {
  max: number;
  interpret: number;
}

interface ScaleDef {
  maxScore: number;
  label: string;
  ranges: Array<{ upTo: number; label: string }>;
}

export const TEST_SCALES: Record<TestType, ScaleDef> = {
  PHQ9: {
    maxScore: 27,
    label: "PHQ-9 (депрессия)",
    ranges: [
      { upTo: 4, label: "Минимальная выраженность симптомов" },
      { upTo: 9, label: "Лёгкая депрессия" },
      { upTo: 14, label: "Умеренная депрессия" },
      { upTo: 19, label: "Умеренно тяжёлая депрессия" },
      { upTo: 27, label: "Тяжёлая депрессия" },
    ],
  },
  GAD7: {
    maxScore: 21,
    label: "GAD-7 (тревожность)",
    ranges: [
      { upTo: 4, label: "Минимальная тревожность" },
      { upTo: 9, label: "Лёгкая тревожность" },
      { upTo: 14, label: "Умеренная тревожность" },
      { upTo: 21, label: "Тяжёлая тревожность" },
    ],
  },
  WHO5: {
    maxScore: 100,
    label: "WHO-5 (благополучие)",
    ranges: [
      { upTo: 28, label: "Низкое благополучие — риск депрессии, рекомендован скрининг" },
      { upTo: 50, label: "Сниженное благополучие" },
      { upTo: 100, label: "Хорошее благополучие" },
    ],
  },
  PCL5: {
    maxScore: 80,
    label: "PCL-5 (ПТСР)",
    ranges: [
      { upTo: 32, label: "Симптомы ниже клинического порога" },
      { upTo: 80, label: "Клинически значимые симптомы ПТСР" },
    ],
  },
  BDI: {
    maxScore: 63,
    label: "BDI (депрессия, Бек)",
    ranges: [
      { upTo: 13, label: "Отсутствие депрессии" },
      { upTo: 19, label: "Лёгкая депрессия" },
      { upTo: 28, label: "Умеренная депрессия" },
      { upTo: 63, label: "Тяжёлая депрессия" },
    ],
  },
};

export function interpretScore(testType: TestType, score: number): string {
  const scale = TEST_SCALES[testType];
  const range = scale.ranges.find(r => score <= r.upTo);
  return range?.label ?? scale.ranges[scale.ranges.length - 1].label;
}

export function getMaxScore(testType: TestType): number {
  return TEST_SCALES[testType].maxScore;
}
