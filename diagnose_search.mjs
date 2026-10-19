// ============================================================
// diagnose_search.mjs — НЕ пишет в БД, только читает.
//
// Задача: понять, почему на вопрос "Где найти шаблоны протоколов?"
// ассистент дал неверный ответ ("Сессии → Шаблоны" вместо "База знаний →
// Шаблоны протоколов") вместо того, чтобы использовать загруженную
// platform-статью. Гипотеза: match_knowledge_base возвращает top-3 по
// сходству, и 7 терапевтических материалов source_type='protocol' (техники
// работы с клиентом) семантически конкурируют с единственной platform-
// статьёй про UI, вытесняя её из топ-3.
//
// Вызывает ТОТ ЖЕ RPC (match_knowledge_base), с тем же query embedding,
// что получил бы реальный agent executor на этот вопрос — воспроизводит
// его один в один, просто печатает результат вместо использования в чате.
//
// Запуск: node diagnose_search.mjs
// ============================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const YANDEX_GPT_API_KEY = process.env.YANDEX_GPT_API_KEY;
const YANDEX_GPT_FOLDER_ID = process.env.YANDEX_GPT_FOLDER_ID;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const YANDEX_EMBEDDING_URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding";

async function yandexGptEmbed(text, textType = "query") {
  const modelSlug =
    textType === "query"
      ? process.env.YANDEX_EMBEDDINGS_MODEL_QUERY || "text-search-query"
      : process.env.YANDEX_EMBEDDINGS_MODEL || "text-search-doc";
  const body = { modelUri: `emb://${YANDEX_GPT_FOLDER_ID}/${modelSlug}/latest`, text };
  const response = await fetch(YANDEX_EMBEDDING_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Api-Key ${YANDEX_GPT_API_KEY}`,
      "x-folder-id": YANDEX_GPT_FOLDER_ID,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Embeddings ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.embedding;
}

async function main() {
  // Психолог из теста — Антон Имершон (alejnikovanton2@gmail.com).
  const { data: psychologists } = await supabase
    .from("psychologists")
    .select("id, email")
    .eq("email", "alejnikovanton2@gmail.com");
  const psych = psychologists?.[0];
  if (!psych) {
    console.error("Психолог не найден по email — проверю первого попавшегося.");
  }
  const psychId = psych?.id ?? (await supabase.from("psychologists").select("id").limit(1)).data?.[0]?.id;
  console.log("psychologist_id:", psychId);

  const queries = [
    "Где найти шаблоны протоколов?",
    "Как создать свой шаблон протокола сессии?",
  ];

  for (const q of queries) {
    console.log(`\n=== Запрос: "${q}" ===`);
    const embedding = await yandexGptEmbed(q, "query");
    const { data, error } = await supabase.rpc("match_knowledge_base", {
      query_embedding: embedding,
      match_psychologist_id: psychId,
      match_approach: null,
      match_count: 3,
    });
    if (error) {
      console.error("RPC error:", error.message);
      continue;
    }
    for (const row of data ?? []) {
      console.log(`  [${row.source_type}] "${row.title}" (similarity: ${row.similarity ?? row.score ?? "?"})`);
      console.log(`    ${(row.content ?? "").slice(0, 100)}...`);
    }
    if (!data || data.length === 0) console.log("  (пусто)");
  }
}

main().catch(e => {
  console.error("ОШИБКА:", e.message ?? e);
  process.exit(1);
});
