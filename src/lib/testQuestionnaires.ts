// ------------------------------------------------------------
// Типы и логика подсчёта для реальных интерактивных опросников
// (в отличие от testScales.ts, где балл психолог вводит вручную —
// здесь клиент отвечает на вопросы по ссылке, и балл считается
// автоматически по ключу опросника, хранящемуся в БД
// (test_questionnaires.schema, см. migration_011)).
//
// Схема одного опросника соответствует JSONB в test_questionnaires.schema —
// формат зафиксирован здесь и должен совпадать с комментарием в миграции.
// ------------------------------------------------------------

export interface ResponseOption {
  value: number;
  label: string;
}

export interface QuestionnaireQuestion {
  id: string;
  text: string;
  /** Обратный ключ — при подсчёте балл вопроса инвертируется (max - value). */
  reverse?: boolean;
  /** К какой субшкале относится вопрос (если есть деление на субшкалы). */
  subscale?: string;
  /** Переопределяет responseScale опросника для этого конкретного вопроса. */
  responseScale?: ResponseOption[];
}

export interface InterpretationRange {
  upTo: number;
  label: string;
}

/** Один пункт для ранжирования (методики типа Рокич — расставить по значимости, не Likert-шкала). */
export interface RankingItem {
  id: string;
  text: string;
}

export interface QuestionnaireSchema {
  /**
   * "likert" (по умолчанию, если не указано) — обычный опросник с
   * шкалой ответов и суммированием/усреднением баллов. "ranking" —
   * клиент расставляет пункты по порядку значимости (нет единого
   * "правильного" балла и диапазонов интерпретации — результат это
   * сам порядок, который психолог обсуждает с клиентом).
   */
  type?: "likert" | "ranking";
  /** Общая шкала ответов для всех вопросов, если не переопределена в вопросе. Только для type="likert". */
  responseScale?: ResponseOption[];
  /** Вопросы опросника — только для type="likert" (или не указан). */
  questions?: QuestionnaireQuestion[];
  /** Пункты для ранжирования — только для type="ranking". */
  rankingItems?: RankingItem[];
  /** Название группы пунктов для ranking-опросника с несколькими группами (например, терминальные/инструментальные ценности Рокича). */
  rankingGroups?: Array<{ key: string; label: string; items: RankingItem[] }>;
  subscales?: Array<{ key: string; label: string }>;
  scoring: "sum" | "average" | "ranking";
  ranges: InterpretationRange[];
  subscaleRanges?: Record<string, InterpretationRange[]>;
}

export interface QuestionnaireResult {
  score: number;
  maxScore: number;
  interpretation: string;
  subscaleScores?: Record<string, { score: number; maxScore: number; interpretation: string }>;
  /** Для ranking-опросников — итоговый порядок пунктов (id) по группам, от самого значимого к наименее. */
  rankingResult?: Record<string, string[]>;
}

/**
 * Считает итоговый балл (и баллы по субшкалам, если есть) на основе
 * ответов клиента. answers — { questionId: value }, value должен
 * совпадать с одним из value в responseScale вопроса/опросника.
 * Бросает Error, если какой-то вопрос не отвечен — вызывающий код
 * (POST /api/public/test/[token]/submit) должен проверить это
 * заранее и вернуть понятную 400-ошибку клиенту.
 *
 * Для type="ranking" передайте answers как { groupKey: string[] } —
 * см. scoreRankingQuestionnaire ниже, эта функция для ranking не подходит.
 */
export function scoreQuestionnaire(
  schema: QuestionnaireSchema,
  answers: Record<string, number>
): QuestionnaireResult {
  const perQuestion: Array<{ q: QuestionnaireQuestion; raw: number; max: number }> = [];
  const questions = schema.questions ?? [];
  if (questions.length === 0) {
    throw new Error("У опросника нет вопросов (возможно, это ranking-опросник — используйте scoreRankingQuestionnaire)");
  }

  for (const q of questions) {
    const scale = q.responseScale ?? schema.responseScale;
    if (!scale || scale.length === 0) {
      throw new Error(`Вопрос ${q.id} не имеет шкалы ответов`);
    }
    const value = answers[q.id];
    if (value === undefined || value === null) {
      throw new Error(`Нет ответа на вопрос ${q.id}`);
    }
    const maxOptionValue = Math.max(...scale.map(o => o.value));
    const minOptionValue = Math.min(...scale.map(o => o.value));
    const raw = q.reverse ? maxOptionValue - (value - minOptionValue) : value;
    perQuestion.push({ q, raw, max: maxOptionValue });
  }

  const aggregate = (items: Array<{ raw: number; max: number }>) => {
    const sum = items.reduce((acc, i) => acc + i.raw, 0);
    const maxSum = items.reduce((acc, i) => acc + i.max, 0);
    if (schema.scoring === "average") {
      const avg = items.length > 0 ? sum / items.length : 0;
      const maxAvg = items.length > 0 ? maxSum / items.length : 0;
      return { score: Math.round(avg * 100) / 100, maxScore: Math.round(maxAvg * 100) / 100 };
    }
    return { score: sum, maxScore: maxSum };
  };

  const total = aggregate(perQuestion.map(p => ({ raw: p.raw, max: p.max })));
  const interpretation = interpretByRanges(total.score, schema.ranges);

  let subscaleScores: QuestionnaireResult["subscaleScores"];
  if (schema.subscales && schema.subscales.length > 0) {
    subscaleScores = {};
    for (const sub of schema.subscales) {
      const items = perQuestion.filter(p => p.q.subscale === sub.key);
      if (items.length === 0) continue;
      const subTotal = aggregate(items.map(p => ({ raw: p.raw, max: p.max })));
      const subRanges = schema.subscaleRanges?.[sub.key] ?? schema.ranges;
      subscaleScores[sub.key] = {
        score: subTotal.score,
        maxScore: subTotal.maxScore,
        interpretation: interpretByRanges(subTotal.score, subRanges),
      };
    }
  }

  return { score: total.score, maxScore: total.maxScore, interpretation, subscaleScores };
}

function interpretByRanges(score: number, ranges: InterpretationRange[]): string {
  const sorted = [...ranges].sort((a, b) => a.upTo - b.upTo);
  const found = sorted.find(r => score <= r.upTo);
  return found?.label ?? sorted[sorted.length - 1]?.label ?? "";
}

/**
 * Обрабатывает ответ на ranking-опросник (например, методика ценностных
 * ориентаций Рокича) — клиент присылает не баллы, а порядок пунктов по
 * каждой группе: answers = { groupKey: ["item3", "item1", "item2", ...] }.
 * В отличие от scoreQuestionnaire, здесь нет единого "балла" и диапазонов
 * интерпретации — сам порядок и есть результат, который психолог
 * анализирует вместе с клиентом. Функция только проверяет полноту и
 * корректность ответа (все пункты каждой группы присутствуют ровно
 * один раз) и возвращает порядок как есть.
 */
export function scoreRankingQuestionnaire(
  schema: QuestionnaireSchema,
  answers: Record<string, string[]>
): QuestionnaireResult {
  const groups = schema.rankingGroups ?? (schema.rankingItems ? [{ key: "default", label: "", items: schema.rankingItems }] : []);
  if (groups.length === 0) {
    throw new Error("У опросника нет пунктов для ранжирования");
  }

  const rankingResult: Record<string, string[]> = {};
  for (const group of groups) {
    const order = answers[group.key];
    if (!Array.isArray(order)) {
      throw new Error(`Нет порядка для группы "${group.key}"`);
    }
    const expectedIds = new Set(group.items.map(i => i.id));
    const gotIds = new Set(order);
    if (order.length !== group.items.length || expectedIds.size !== gotIds.size || [...expectedIds].some(id => !gotIds.has(id))) {
      throw new Error(`Порядок для группы "${group.key}" должен содержать каждый пункт ровно один раз`);
    }
    rankingResult[group.key] = order;
  }

  return { score: 0, maxScore: 0, interpretation: "Результат — порядок пунктов, см. rankingResult", rankingResult };
}

/** Генерирует случайный URL-safe токен для публичной ссылки на тест. */
export function generateTestAccessToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
