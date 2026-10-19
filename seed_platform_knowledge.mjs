// ============================================================
// seed_platform_knowledge.mjs
//
// Загружает 12 статей про устройство самой платформы (задача #57/#60)
// в knowledge_base, чтобы ассистент мог отвечать на справочные вопросы
// психологов ("как поменять часовой пояс", "как подключить Telegram")
// фактами, а не домыслами.
//
// source_type='manual' — CHECK-constraint в БД (проверено диагностикой:
// knowledge_base_source_type_check) разрешает только technique/article/
// protocol/manual/homework/test, 'platform' туда не входит и добавлять
// новое значение в constraint ради этого не стали — 'manual' уже
// используется в проекте для некликентских справочных материалов
// (см. APPROACH_SEED_KNOWLEDGE, "manual" в блоке other — этический
// кодекс психолога). topic='platform' — для группировки/фильтрации,
// это свободное текстовое поле, никакого constraint на него нет.
//
// АРХИТЕКТУРА: knowledge_base не имеет общей (без владельца) записи —
// все API-и и match_knowledge_base фильтруют по psychologist_id. Есть
// прецедент общих материалов — migration_024_backfill_shared_knowledge.sql
// решает это ДУБЛИРОВАНИЕМ: одна и та же строка (тот же текст, тот же
// эмбеддинг) вставляется отдельно для каждого psychologist_id. Этот
// скрипт по умолчанию делает то же самое — это вариант А.
//
// Вариант Б (без дублирования, через общую запись с psychologist_id=null
// или через доработку match_knowledge_base) включается флагом
// MODE=shared ниже, если диагностика pg_get_functiondef(match_knowledge_base)
// покажет, что функция это поддерживает (или после того как функцию
// доработают). Пока флаг не переключён вручную — используется вариант А.
//
// Эмбеддинги считаются один раз на статью (не на психолога) — экономия
// вызовов YandexGPT Embeddings, для каждого психолога переиспользуется
// тот же вектор (текст идентичен, вектор будет идентичен), ровно как в
// migration_024.
//
// Запуск: node seed_platform_knowledge.mjs [--dry-run]
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Конфигурация ---
const MODE = process.env.SEED_MODE || "dedupe-per-psychologist"; // | "shared-no-owner"
const DRY_RUN = process.argv.includes("--dry-run");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const YANDEX_GPT_API_KEY = process.env.YANDEX_GPT_API_KEY;
const YANDEX_GPT_FOLDER_ID = process.env.YANDEX_GPT_FOLDER_ID;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Не найдены NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в окружении.");
  process.exit(1);
}
if (!YANDEX_GPT_API_KEY || !YANDEX_GPT_FOLDER_ID) {
  console.error("Не найдены YANDEX_GPT_API_KEY / YANDEX_GPT_FOLDER_ID в окружении.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const YANDEX_EMBEDDING_URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding";

async function yandexGptEmbed(text) {
  const modelSlug = process.env.YANDEX_EMBEDDINGS_MODEL || "text-search-doc";
  const body = {
    modelUri: `emb://${YANDEX_GPT_FOLDER_ID}/${modelSlug}/latest`,
    text,
  };
  const response = await fetch(YANDEX_EMBEDDING_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Api-Key ${YANDEX_GPT_API_KEY}`,
      "x-folder-id": YANDEX_GPT_FOLDER_ID,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`YandexGPT Embeddings ${response.status}: ${details}`);
  }
  const data = await response.json();
  const vector = data?.embedding;
  if (!Array.isArray(vector)) {
    throw new Error(`Неожиданный формат ответа эмбеддинга: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return vector;
}

async function main() {
  const articlesPath = join(__dirname, "platform_articles.json");
  const articles = JSON.parse(readFileSync(articlesPath, "utf-8"));
  console.log(`Загружено ${articles.length} статей из ${articlesPath}`);
  console.log(`Режим: ${MODE}${DRY_RUN ? " (DRY RUN — ничего не пишем в БД)" : ""}`);

  // 1. Уже существующие platform-статьи — чтобы не дублировать при повторном запуске.
  const { data: existing, error: existingErr } = await supabase
    .from("knowledge_base")
    .select("id, title, psychologist_id")
    .eq("topic", "platform");
  if (existingErr) throw existingErr;
  const existingKey = new Set((existing ?? []).map(r => `${r.psychologist_id}::${r.title}`));
  console.log(`Уже в базе: ${existing?.length ?? 0} строк с topic='platform'`);

  // 2. Считаем эмбеддинг для каждой статьи один раз.
  console.log("Считаю эмбеддинги...");
  const withEmbeddings = [];
  for (const a of articles) {
    const embedding = await yandexGptEmbed(a.content);
    withEmbeddings.push({ ...a, embedding });
    console.log(`  ✓ "${a.title}" — вектор из ${embedding.length} чисел`);
  }

  if (MODE === "shared-no-owner") {
    // --- Вариант Б: общая запись без владельца ---
    // Использовать ТОЛЬКО если диагностика match_knowledge_base подтвердила
    // поддержку (например "match_psychologist_id is null or psychologist_id
    // = match_psychologist_id"), и psychologist_id в схеме knowledge_base
    // допускает NULL. Если колонка NOT NULL — этот режим не сработает,
    // нужен вариант А.
    const rows = withEmbeddings.map(a => ({
      psychologist_id: null,
      title: a.title,
      content: a.content,
      embedding: a.embedding,
      source_type: "manual",
      topic: a.topic,
    }));
    console.log(`Вариант Б: вставляю ${rows.length} общих строк без владельца.`);
    if (DRY_RUN) {
      console.log(JSON.stringify(rows.map(r => r.title), null, 2));
      return;
    }
    const { error } = await supabase.from("knowledge_base").insert(rows);
    if (error) throw error;
    console.log("Готово.");
    return;
  }

  // --- Вариант А (по умолчанию): дублируем на каждого существующего психолога ---
  const { data: psychologists, error: psychErr } = await supabase
    .from("psychologists")
    .select("id");
  if (psychErr) throw psychErr;
  console.log(`Психологов в базе: ${psychologists?.length ?? 0}`);

  const rows = [];
  for (const p of psychologists ?? []) {
    for (const a of withEmbeddings) {
      const key = `${p.id}::${a.title}`;
      if (existingKey.has(key)) continue; // уже загружено этому психологу — не дублируем
      rows.push({
        psychologist_id: p.id,
        title: a.title,
        content: a.content,
        embedding: a.embedding,
        source_type: "manual",
        topic: a.topic,
      });
    }
  }

  console.log(`Вариант А: к вставке ${rows.length} строк (${withEmbeddings.length} статей × ${psychologists?.length ?? 0} психологов, за вычетом уже существующих).`);

  if (DRY_RUN) {
    console.log("DRY RUN — ничего не вставлено. Пример первых 3 строк:");
    console.log(rows.slice(0, 3).map(r => ({ psychologist_id: r.psychologist_id, title: r.title })));
    return;
  }

  // Вставляем пачками, чтобы не упереться в лимит одного запроса.
  const BATCH_SIZE = 200;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("knowledge_base").insert(batch);
    if (error) throw error;
    console.log(`  Вставлено ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }

  console.log("Готово.");
}

main().catch(e => {
  console.error("ОШИБКА:", e.message ?? e);
  process.exit(1);
});
