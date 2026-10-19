import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv(join(repoRoot, ".env.local"));

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: authUsers, error: authErr } = await supabase.auth.admin.listUsers();
if (authErr) { console.error("authErr:", authErr.message); process.exit(1); }
console.log("Всего пользователей:", authUsers.users.length);
console.log(authUsers.users.map(u => u.email).join("\n"));
const user = authUsers.users.find(u => u.email?.toLowerCase() === "alejnikovanton182@gmail.com");
if (!user) { console.error("Пользователь не найден"); process.exit(1); }
const psychologistId = user.id;

const { data, error } = await supabase.from("knowledge_base").select("title, approach, source_type").eq("psychologist_id", psychologistId);
if (error) { console.error(error); process.exit(1); }

console.log("Всего материалов:", data.length);

const byType = {};
for (const row of data) byType[row.source_type] = (byType[row.source_type] || 0) + 1;
console.log("По source_type:", byType);

const byApproach = {};
for (const row of data) byApproach[row.approach] = (byApproach[row.approach] || 0) + 1;
console.log("По approach:", byApproach);

const seen = new Map();
const dups = [];
for (const row of data) {
  const key = `${row.approach}|||${row.title}`;
  if (seen.has(key)) dups.push(key);
  seen.set(key, true);
}
console.log("Точных дублей (approach+title):", dups.length, dups);

const titles = data.map(r => `[${r.approach}] ${r.title}`).sort();
console.log("\nВсе заголовки:\n" + titles.join("\n"));
