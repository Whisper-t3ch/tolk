#!/usr/bin/env node
// Прогон сценариев ассистента против работающего сервера.
//   BASE=https://tolkplace.ru COOKIE='sb-...=...; ...' CLIENT_NAME=Анна node scripts/assistant-regression/run.mjs
// COOKIE — заголовок Cookie из любого запроса к /api/* в DevTools → Network (под залогиненным психологом).
// Каждый сценарий — новый диалог. Подтверждения не нажимаются, данные не меняются. Расход: 1 запрос лимита на сценарий.
import { scenarios, BAD } from "./scenarios.mjs";

const BASE = process.env.BASE ?? "https://tolkplace.ru";
const COOKIE = process.env.COOKIE ?? "";
const CLIENT = process.env.CLIENT_NAME ?? "Анна";
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY, "i") : null;
if (!COOKIE) {
  console.error("Нужна переменная COOKIE (см. комментарий в начале файла)");
  process.exit(2);
}

let failed = 0;
let total = 0;
for (const sc of scenarios) {
  if (ONLY && !ONLY.test(sc.name)) continue;
  total++;
  const say = sc.say.replaceAll("{C}", CLIENT);
  const t0 = Date.now();
  let res, data, raw = "";
  try {
    res = await fetch(`${BASE}/api/assistant`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: COOKIE }, body: JSON.stringify({ message: say }) });
    raw = await res.text();
    data = JSON.parse(raw);
  } catch (e) {
    data = { error: `${res?.status ?? ""} ${raw.slice(0, 120) || e.message}` };
  }
  const isCard = data?.type === "confirmation_required";
  const text = isCard ? data.description : data?.message ?? "";
  const problems = [];
  if (data?.error) problems.push(`ошибка API: ${data.error}`);
  if (BAD.test(text)) problems.push("в ответе техническая ошибка/служебный текст");
  if (sc.expect === "card" && !isCard) problems.push("ждали карточку подтверждения");
  if (sc.expect === "card" && isCard && sc.tool && data.action?.tool !== sc.tool) problems.push(`ждали ${sc.tool}, пришёл ${data.action?.tool}`);
  if (sc.expect === "text" && isCard) problems.push("ждали обычный ответ, пришла карточка");
  if (sc.match && !sc.match.test(text)) problems.push(`ответ не подходит под ${sc.match}`);
  const ok = problems.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${sc.name} (${((Date.now() - t0) / 1000).toFixed(1)} с)`);
  if (!ok) {
    console.log(`     > ${say}`);
    console.log(`     ${problems.join("; ")}`);
    console.log(`     ответ: ${String(text).replace(/\s+/g, " ").slice(0, 220)}`);
  }
}
console.log(`\nИтого: ${total - failed}/${total} прошли`);
process.exit(failed ? 1 : 0);
