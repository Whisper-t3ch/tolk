import type { SupabaseClient } from "@supabase/supabase-js";
import { APPROACH_SEED_KNOWLEDGE, type Approach } from "@/lib/approaches";
import { checkYandexGptEnv, yandexGptEmbed } from "@/lib/yandexgpt";
import platformArticles from "@/lib/data/platformArticles.json";

type SeedRow = {
  psychologist_id: string;
  title: string;
  content: string;
  embedding: number[];
  source_type: string;
  approach: string;
  topic: string | null;
  questionnaire_key: string | null;
};

type RawItem = {
  title: string;
  content: string;
  source_type: string;
  approach: string;
  topic: string | null;
  questionnaire_key: string | null;
};

async function embedAll(items: RawItem[], userId: string): Promise<SeedRow[]> {
  const rows: SeedRow[] = [];
  const BATCH = 4;
  for (let i = 0; i < items.length; i += BATCH) {
    const part = items.slice(i, i + BATCH);
    const embs = await Promise.all(part.map(it => yandexGptEmbed(it.content, "doc")));
    part.forEach((it, k) => rows.push({ psychologist_id: userId, ...it, embedding: embs[k] }));
  }
  return rows;
}

/**
 * Гарантирует, что у психолога есть стартовая база знаний:
 *  - материалы выбранного подхода + общие методики (если БЗ пуста);
 *  - справочные статьи о платформе (если их ещё нет).
 * Раньше сидинг шёл только внутри онбординга и молча проваливался при
 * ошибке эмбеддингов — у второго аккаунта БЗ оставалась пустой навсегда.
 * Best-effort: ошибки логируются, вызывающий код не падает.
 */
const inflight = new Map<string, Promise<number>>();
// После неудачи не долбим эмбеддинги на каждом GET: следующая попытка через 5 минут.
const lastFailAt = new Map<string, number>();
const RETRY_AFTER_MS = 5 * 60_000;

export function ensureKnowledgeSeed(supabase: SupabaseClient, userId: string): Promise<number> {
  // Параллельные GET /api/knowledge не должны сидить дважды.
  const running = inflight.get(userId);
  if (running) return running;
  const failedAt = lastFailAt.get(userId);
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return Promise.resolve(0);
  const p = seed(supabase, userId)
    .then(n => {
      lastFailAt.delete(userId);
      return n;
    })
    .catch(() => {
      lastFailAt.set(userId, Date.now());
      return 0;
    })
    .finally(() => inflight.delete(userId));
  inflight.set(userId, p);
  return p;
}

async function seed(supabase: SupabaseClient, userId: string): Promise<number> {
  if (!checkYandexGptEnv().configured) return 0;
  try {
    const [{ count: total }, { count: platform }, { data: prof }] = await Promise.all([
      supabase.from("knowledge_base").select("id", { count: "exact", head: true }).eq("psychologist_id", userId),
      supabase
        .from("knowledge_base")
        .select("id", { count: "exact", head: true })
        .eq("psychologist_id", userId)
        .eq("topic", "platform"),
      supabase.from("psychologists").select("approach").eq("id", userId).maybeSingle(),
    ]);

    const items: RawItem[] = [];
    // Своих материалов нет (статьи о платформе не в счёт: их мог залить скрипт, и тогда подход-материалы не сидились никогда).
    if (!((total ?? 0) - (platform ?? 0))) {
      const approach = ((prof?.approach as Approach | null) ?? "other") as Approach;
      const own = APPROACH_SEED_KNOWLEDGE[approach] ?? [];
      const shared = approach === "other" ? [] : (APPROACH_SEED_KNOWLEDGE.other ?? []);
      for (const it of [...own, ...shared]) {
        items.push({
          title: it.title,
          content: it.content,
          source_type: it.source_type,
          approach: own.includes(it) ? approach : "other",
          topic: null,
          questionnaire_key: it.questionnaireKey ?? null,
        });
      }
    }
    if (!platform) {
      for (const a of platformArticles as Array<{ title: string; topic: string; content: string }>) {
        items.push({
          title: a.title,
          content: a.content,
          source_type: "manual",
          approach: "other",
          topic: a.topic || "platform",
          questionnaire_key: null,
        });
      }
    }
    if (items.length === 0) return 0;

    const rows = await embedAll(items, userId);
    const { error } = await supabase.from("knowledge_base").insert(rows);
    if (error) {
      console.error("KB_SEED_INSERT_FAILED", error.message);
      throw new Error(error.message);
    }
    console.log("KB_SEEDED", userId, rows.length);
    return rows.length;
  } catch (e) {
    console.error("KB_SEED_FAILED", e instanceof Error ? e.message : e);
    throw e;
  }
}
