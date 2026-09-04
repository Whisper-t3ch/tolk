// ============================================================
// Одноразовый скрипт: догружает расширенную APPROACH_SEED_KNOWLEDGE
// (105 материалов — по 15 на каждый из 6 подходов + 15 в общем
// разделе) на уже существующий аккаунт психолога, который прошёл
// онбординг раньше, до расширения базы знаний.
//
// Обычный путь (POST /api/knowledge через браузерную сессию) сюда не
// подходит — набор большой, и это одноразовая операция, а не то, что
// должно быть доступно как публичный API endpoint. Использует
// SUPABASE_SERVICE_ROLE_KEY напрямую (обходит RLS), поэтому запускать
// только локально, никогда не как часть деплоя.
//
// Запуск (из корня репозитория tolk-demo):
//   node outputs/backend/seed_knowledge_base.mjs <email психолога>
//
// Требует переменные окружения (те же, что в .env.local Vercel):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   YANDEX_GPT_API_KEY
//   YANDEX_GPT_FOLDER_ID
//
// Пропускает подходы, для которых у психолога уже есть материалы в
// knowledge_base (тот же принцип "не дублировать", что и в онбординге) —
// безопасно перезапускать, если что-то не доехало с первого раза.
// ============================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const YANDEX_API_KEY = process.env.YANDEX_GPT_API_KEY;
const YANDEX_FOLDER_ID = process.env.YANDEX_GPT_FOLDER_ID;
const YANDEX_EMBEDDINGS_MODEL = process.env.YANDEX_EMBEDDINGS_MODEL || "text-search-doc";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в окружении");
  process.exit(1);
}
if (!YANDEX_API_KEY || !YANDEX_FOLDER_ID) {
  console.error("Нужны YANDEX_GPT_API_KEY и YANDEX_GPT_FOLDER_ID в окружении");
  process.exit(1);
}

const email = process.argv[2];
if (!email) {
  console.error("Использование: node seed_knowledge_base.mjs <email психолога>");
  process.exit(1);
}

// APPROACH_SEED_KNOWLEDGE живёт в src/lib/approaches.ts как TypeScript —
// чтобы не тащить в этот одноразовый скрипт ts-node/tsx как зависимость,
// читаем файл как текст и извлекаем сам объект (TS-типы в нём не влияют
// на значение — валидный TS object literal здесь является одновременно
// валидным JS object literal).
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const approachesPath = join(__dirname, "..", "..", "src", "lib", "approaches.ts");
const src = readFileSync(approachesPath, "utf8");

const startMarker = "export const APPROACH_SEED_KNOWLEDGE";
const start = src.indexOf(startMarker);
if (start === -1) {
  console.error("Не найден APPROACH_SEED_KNOWLEDGE в src/lib/approaches.ts");
  process.exit(1);
}
// Тип объявлен многострочно (Record<Approach, Array<{...}>>) перед "= {" —
// ищем именно литерал "= {" после маркера, а не первую попавшуюся "{"
// (которая иначе находится внутри самого типа Array<{...}>).
const assignIdx = src.indexOf("= {", start);
if (assignIdx === -1) {
  console.error("Не найдено присваивание объекта после APPROACH_SEED_KNOWLEDGE");
  process.exit(1);
}
const objStart = assignIdx + 2; // индекс самой "{"
// APPROACH_SEED_KNOWLEDGE — последнее объявление в файле, поэтому его
// закрывающая "};" — последнее вхождение "\n};" в файле, а не первое
// (indexOf нашёл бы более раннее совпадение, если оно есть где-то выше).
// +2 — индекс сразу ПОСЛЕ закрывающей "}" (пропускаем "\n", берём "}",
// не берём ";"), чтобы объект остался валидным без висящей точки с запятой.
const objEnd = src.lastIndexOf("\n};") + 2;
const objectLiteral = src.slice(objStart, objEnd);

// objectLiteral — валидный JS-object-literal (TS-типы уже не участвуют
// в значении), выполняем его как JS через Function — безопасно, так
// как источник это наш собственный файл в репозитории, не внешний ввод.
// eslint-disable-next-line no-new-func
const APPROACH_SEED_KNOWLEDGE = new Function(`"use strict"; return (${objectLiteral});`)();

const APPROACHES = Object.keys(APPROACH_SEED_KNOWLEDGE);
const totalItems = APPROACHES.reduce((sum, a) => sum + APPROACH_SEED_KNOWLEDGE[a].length, 0);
console.log(`Прочитано ${totalItems} материалов из approaches.ts по ${APPROACHES.length} разделам: ${APPROACHES.join(", ")}`);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function yandexEmbed(text) {
  const res = await fetch("https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Api-Key ${YANDEX_API_KEY}`,
      "x-folder-id": YANDEX_FOLDER_ID,
    },
    body: JSON.stringify({
      modelUri: `emb://${YANDEX_FOLDER_ID}/${YANDEX_EMBEDDINGS_MODEL}/latest`,
      text,
    }),
  });
  if (!res.ok) {
    const details = await res.text().catch(() => "");
    throw new Error(`YandexGPT Embeddings ${res.status}: ${details}`);
  }
  const data = await res.json();
  if (!Array.isArray(data.embedding)) {
    throw new Error("Неожиданный формат ответа YandexGPT Embeddings");
  }
  return data.embedding;
}

async function main() {
  const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
  if (authError) {
    console.error("Не удалось получить список пользователей:", authError.message);
    process.exit(1);
  }
  const user = authUsers.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    console.error(`Пользователь с email ${email} не найден`);
    process.exit(1);
  }
  const psychologistId = user.id;
  console.log(`Найден психолог: ${email} (${psychologistId})`);

  const { data: existing, error: existingError } = await supabase
    .from("knowledge_base")
    .select("id, approach")
    .eq("psychologist_id", psychologistId);
  if (existingError) {
    console.error("Не удалось прочитать существующую базу знаний:", existingError.message);
    process.exit(1);
  }
  const approachesWithContent = new Set((existing ?? []).map(row => row.approach).filter(Boolean));
  if (approachesWithContent.size > 0) {
    console.log(`У психолога уже есть материалы по: ${[...approachesWithContent].join(", ")} — эти разделы будут пропущены, чтобы не дублировать.`);
  }

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const approach of APPROACHES) {
    if (approachesWithContent.has(approach)) {
      skipped += APPROACH_SEED_KNOWLEDGE[approach].length;
      continue;
    }
    const items = APPROACH_SEED_KNOWLEDGE[approach];
    console.log(`\n${approach}: ${items.length} материалов`);
    for (const item of items) {
      try {
        const embedding = await yandexEmbed(item.content);
        const { error: insertError } = await supabase.from("knowledge_base").insert({
          psychologist_id: psychologistId,
          title: item.title,
          content: item.content,
          embedding,
          source_type: item.source_type,
          approach,
        });
        if (insertError) throw new Error(insertError.message);
        inserted += 1;
        process.stdout.write(".");
      } catch (e) {
        failed += 1;
        console.error(`\n  Ошибка на "${item.title}": ${e.message}`);
      }
    }
    console.log("");
  }

  console.log(`\nГотово. Вставлено: ${inserted}, пропущено (уже было): ${skipped}, ошибок: ${failed}.`);
}

main().catch(e => {
  console.error("Неожиданная ошибка:", e);
  process.exit(1);
});
