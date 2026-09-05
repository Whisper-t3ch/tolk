// ============================================================
// Скрипт: догружает содержимое APPROACH_SEED_KNOWLEDGE (src/lib/approaches.ts)
// на уже существующий аккаунт психолога, который прошёл онбординг
// раньше, до расширения базы знаний — обычный сидинг срабатывает
// только один раз, при первом онбординге.
//
// Обычный путь (POST /api/knowledge через браузерную сессию) сюда не
// подходит — набор большой, и это одноразовая операция, а не то, что
// должно быть доступно как публичный API endpoint. Использует
// SUPABASE_SERVICE_ROLE_KEY напрямую (обходит RLS), поэтому запускать
// только локально, никогда не как часть деплоя.
//
// Запуск (из корня репозитория tolk-demo) — ключи брать не нужно,
// скрипт сам читает .env.local (тот же файл, что использует next dev):
//   node outputs/backend/seed_knowledge_base.mjs <email психолога>
//
// .env.local должен содержать (уже должны быть там, если приложение
// запускается локально): NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, YANDEX_GPT_API_KEY, YANDEX_GPT_FOLDER_ID.
// Если каких-то значений там нет — можно также задать их как обычные
// переменные окружения перед запуском, они имеют приоритет над .env.local.
//
// Пропускает КОНКРЕТНЫЕ материалы, у которых уже есть запись с тем же
// (title, approach) в базе психолога — не весь раздел целиком. Это
// позволяет безопасно перезапускать скрипт после того, как в
// approaches.ts добавили новые материалы к уже частично загруженному
// разделу (например, дописали шаблоны ДЗ к разделу, где техники уже
// были) — старые записи не дублируются, новые по названию доезжают.
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

// Простой .env-парсер (без зависимости от dotenv): построчно KEY=VALUE,
// пропускает пустые строки и комментарии, снимает кавычки вокруг
// значения, если они есть. Не перезаписывает переменные, уже заданные
// в самом окружении процесса (process.env имеет приоритет).
function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv(join(repoRoot, ".env.local"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const YANDEX_API_KEY = process.env.YANDEX_GPT_API_KEY;
const YANDEX_FOLDER_ID = process.env.YANDEX_GPT_FOLDER_ID;
const YANDEX_EMBEDDINGS_MODEL = process.env.YANDEX_EMBEDDINGS_MODEL || "text-search-doc";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY — не найдены ни в .env.local, ни в окружении процесса");
  process.exit(1);
}
if (!YANDEX_API_KEY || !YANDEX_FOLDER_ID) {
  console.error("Нужны YANDEX_GPT_API_KEY и YANDEX_GPT_FOLDER_ID — не найдены ни в .env.local, ни в окружении процесса");
  process.exit(1);
}

const email = process.argv[2];
if (!email) {
  console.error("Использование: node outputs/backend/seed_knowledge_base.mjs <email психолога>");
  process.exit(1);
}

// APPROACH_SEED_KNOWLEDGE живёт в src/lib/approaches.ts как TypeScript —
// чтобы не тащить в этот одноразовый скрипт ts-node/tsx как зависимость,
// читаем файл как текст и извлекаем сам объект (TS-типы в нём не влияют
// на значение — валидный TS object literal здесь является одновременно
// валидным JS object literal).
const approachesPath = join(repoRoot, "src", "lib", "approaches.ts");
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
    .select("title, approach")
    .eq("psychologist_id", psychologistId);
  if (existingError) {
    console.error("Не удалось прочитать существующую базу знаний:", existingError.message);
    process.exit(1);
  }
  // Ключ "approach|||title" — сравниваем конкретные материалы, а не
  // весь раздел целиком, чтобы можно было дозагружать только новое.
  const existingKeys = new Set((existing ?? []).map(row => `${row.approach ?? ""}|||${row.title ?? ""}`));

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const approach of APPROACHES) {
    const items = APPROACH_SEED_KNOWLEDGE[approach];
    const newItems = items.filter(item => !existingKeys.has(`${approach}|||${item.title}`));
    skipped += items.length - newItems.length;
    if (newItems.length === 0) continue;

    console.log(`\n${approach}: ${newItems.length} новых материалов (из ${items.length})`);
    for (const item of newItems) {
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
