#!/usr/bin/env node
// Проверка и сравнение моделей через OpenAI-совместимый API (Cloud.ru Foundation Models).
//
//   export LLM_API_KEY=...            # ключ Cloud.ru (в чат не присылать)
//   node probe.mjs models             # список доступных моделей и их точные имена
//   node probe.mjs smoke --models "GigaChat/..."          # быстрая проверка связи
//   node probe.mjs run --models "A,B,C" [--repeat 3] [--only t-,n-]   # полный прогон
//
// Env: LLM_BASE_URL (по умолчанию https://foundation-models.api.cloud.ru/v1), LLM_API_KEY.
// GigaChat от Сбера (личный кабинет developers.sber.ru):
//   $env:LLM_DIALECT="gigachat"; $env:LLM_AUTH="gigachat_oauth"; $env:LLM_API_KEY="<Authorization key>"
//   $env:NODE_EXTRA_CA_CERTS="<путь к сертификатам Минцифры .pem>"   # без него TLS к Сберу не пройдёт
//   (scope по умолчанию GIGACHAT_API_PERS, меняется через LLM_OAUTH_SCOPE)
// Результаты: таблица в консоль + сырые ответы в out/<время>.json (только синтетические данные).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CASES, TOOLS, SYSTEM, PSEUDO, PROMPT_VARIANT } from "./cases.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const GIGA = (process.env.LLM_DIALECT || "").toLowerCase() === "gigachat";
const OAUTH = (process.env.LLM_AUTH || "").toLowerCase() === "gigachat_oauth";
const BASE = (process.env.LLM_BASE_URL || (GIGA ? "https://gigachat.devices.sberbank.ru/api/v1" : "https://foundation-models.api.cloud.ru/v1")).replace(/\/+$/, "");
const KEY = process.env.LLM_API_KEY;

let tokenCache = null;
async function bearer(force = false) {
  if (!OAUTH) return `Bearer ${KEY}`;
  if (!force && tokenCache && tokenCache.exp - Date.now() > 60000) return `Bearer ${tokenCache.token}`;
  const res = await fetch(process.env.LLM_OAUTH_URL || "https://ngw.devices.sberbank.ru:9443/api/v2/oauth", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", RqUID: crypto.randomUUID(), Authorization: `Basic ${KEY}` },
    body: new URLSearchParams({ scope: process.env.LLM_OAUTH_SCOPE || "GIGACHAT_API_PERS" }).toString(),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`OAuth HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  tokenCache = { token: j.access_token, exp: Number(j.expires_at) || Date.now() + 25 * 60000 };
  return `Bearer ${tokenCache.token}`;
}
const PRICES = JSON.parse(fs.readFileSync(path.join(here, "prices.json"), "utf8"));

const [cmd = "help", ...rest] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : "true";
}

if (!KEY) { console.error("Нет LLM_API_KEY в окружении."); process.exit(1); }
if (GIGA && !process.env.NODE_EXTRA_CA_CERTS && !process.env.LLM_ALLOW_NO_CA) console.error("Внимание: NODE_EXTRA_CA_CERTS не задан. Без сертификатов Минцифры TLS к серверам Сбера обычно не проходит.");

async function api(pathname, body, method = "POST") {
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = Date.now();
    try {
      let res = await fetch(`${BASE}${pathname}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: await bearer() },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(120000),
      });
      if (res.status === 401 && OAUTH) {
        res = await fetch(`${BASE}${pathname}`, {
          method,
          headers: { "Content-Type": "application/json", Authorization: await bearer(true) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(120000),
        });
      }
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = null; }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
      return { status: res.status, json, text, ms: Date.now() - started };
    } catch (e) {
      if (attempt === 2) return { status: 0, json: null, text: String(e), ms: Date.now() - started };
    }
  }
}

const toolDefs = TOOLS.map(t => ({ type: "function", function: t }));

function buildMessages(c) {
  const m = [{ role: "system", content: SYSTEM }, { role: "user", content: c.user }];
  if (c.kind === "final") {
    if (GIGA) {
      m.push({ role: "assistant", content: "", function_call: { name: c.toolName, arguments: c.toolArgs ?? {} } });
      let content = c.toolResult; try { JSON.parse(content); } catch { content = JSON.stringify({ result: content }); }
      m.push({ role: "function", name: c.toolName, content });
    } else {
      m.push({ role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: c.toolName, arguments: JSON.stringify(c.toolArgs ?? {}) } }] });
      m.push({ role: "tool", tool_call_id: "call_1", content: c.toolResult });
    }
  }
  return m;
}

// Приводит ответ GigaChat (function_call) к форме OpenAI (tool_calls), чтобы судья был общий.
function normalizeMessage(msg) {
  if (msg?.function_call?.name && !msg.tool_calls) {
    const a = msg.function_call.arguments;
    return { ...msg, tool_calls: [{ function: { name: msg.function_call.name, arguments: typeof a === "string" ? a : JSON.stringify(a ?? {}) } }] };
  }
  return msg;
}

function judge(c, msg) {
  const issues = [];
  const calls = msg?.tool_calls ?? [];
  const text = (msg?.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (PSEUDO.test(text)) issues.push("pseudo-tool-call в тексте");
  if (c.kind === "tool") {
    if (!calls.length) issues.push("нет вызова функции");
    else {
      const first = calls[0].function;
      if (!c.expect.includes(first.name)) issues.push(`не тот инструмент: ${first.name}`);
      let args = {};
      try { args = JSON.parse(first.arguments || "{}"); } catch { issues.push("arguments не JSON"); }
      if (c.args && !c.args(args)) issues.push(`аргументы: ${first.arguments}`);
    }
  } else if (c.kind === "no_tool" || c.kind === "final") {
    if (calls.length) issues.push(`лишний вызов: ${calls[0].function.name}`);
    if (!text) issues.push("пустой ответ");
    if (c.mustMatch && !c.mustMatch.test(text)) issues.push("нет ожидаемого содержания");
    if (c.mustMatch2 && !c.mustMatch2.test(text)) issues.push("нет ожидаемого содержания (2)");
  } else if (c.kind === "json") {
    const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    let obj; try { obj = JSON.parse(cleaned); } catch { issues.push("не JSON"); }
    if (obj) {
      for (const k of c.keys ?? []) if (!(k in obj)) issues.push(`нет ключа ${k}`);
      for (const bad of c.mustNotContain ?? []) if (JSON.stringify(obj).includes(bad)) issues.push(`утечка: ${bad}`);
    }
    if (text !== cleaned) issues.push("JSON в markdown-обёртке");
  }
  return { ok: issues.filter(i => !i.includes("markdown-обёртке")).length === 0, issues, text };
}

function priceFor(model) {
  const k = Object.keys(PRICES).find(k => !k.startsWith("_") && model.toLowerCase().includes(k));
  return k ? PRICES[k] : null;
}
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

async function runModel(model, cases, repeat) {
  const rows = [];
  for (const c of cases) {
    for (let r = 0; r < repeat; r++) {
      const body = { model, messages: buildMessages(c), temperature: 0.3, max_tokens: 1200, stream: false };
      if (c.kind === "tool" || c.kind === "no_tool" || c.kind === "final") {
        if (GIGA) { body.functions = TOOLS; body.function_call = "auto"; } else { body.tools = toolDefs; body.tool_choice = "auto"; }
      }
      if (c.kind === "json" && !GIGA) body.response_format = { type: "json_object" };
      const res = await api("/chat/completions", body);
      const msg = normalizeMessage(res.json?.choices?.[0]?.message);
      let verdict;
      if (res.status !== 200 || !msg) verdict = { ok: false, issues: [`HTTP ${res.status}: ${String(res.text).slice(0, 160)}`], text: "" };
      else verdict = judge(c, msg);
      rows.push({
        case: c.id, kind: c.kind, run: r, ok: verdict.ok, issues: verdict.issues, ms: res.ms,
        in: res.json?.usage?.prompt_tokens ?? 0, out: res.json?.usage?.completion_tokens ?? 0,
        text: verdict.text, tool_calls: msg?.tool_calls ?? null,
      });
      process.stdout.write(verdict.ok ? "." : "x");
    }
  }
  process.stdout.write("\n");
  return rows;
}

function summarize(model, rows) {
  const n = rows.length, ok = rows.filter(r => r.ok).length;
  const byKind = {};
  for (const r of rows) { (byKind[r.kind] ??= { n: 0, ok: 0 }).n++; if (r.ok) byKind[r.kind].ok++; }
  const lat = rows.map(r => r.ms);
  const avgIn = rows.reduce((s, r) => s + r.in, 0) / n, avgOut = rows.reduce((s, r) => s + r.out, 0) / n;
  const p = priceFor(model);
  const cost1k = p ? ((avgIn * p[0] + avgOut * p[1]) / 1e6) * 1000 : null;
  return { model, n, ok, byKind, p50: pct(lat, 0.5), p95: pct(lat, 0.95), avgIn: Math.round(avgIn), avgOut: Math.round(avgOut), cost1k };
}

if (cmd === "models") {
  const res = await api("/models", null, "GET");
  if (res.status !== 200) { console.error(`HTTP ${res.status}`, res.text.slice(0, 300)); process.exit(1); }
  for (const m of res.json?.data ?? []) console.log(m.id);
} else if (cmd === "smoke" || cmd === "run") {
  const models = (flags.models || process.env.LLM_MODELS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!models.length) { console.error('Укажите --models "имя1,имя2" (точные имена: node probe.mjs models)'); process.exit(1); }
  let cases = CASES;
  if (cmd === "smoke") cases = CASES.filter(c => ["t-list", "n-tz", "f-list", "j-summary"].includes(c.id));
  if (flags.only) { const pre = flags.only.split(","); cases = cases.filter(c => pre.some(p => c.id.startsWith(p))); }
  const repeat = Number(flags.repeat || (cmd === "smoke" ? 1 : 3));
  const all = {}, sums = [];
  for (const m of models) {
    console.log(`\n== ${m} (${cases.length} кейсов × ${repeat})`);
    all[m] = await runModel(m, cases, repeat);
    sums.push(summarize(m, all[m]));
  }
  console.log("\n| Модель | Пройдено | tool | no_tool | final | json | p50, с | p95, с | ток. вх/вых | ₽ за 1000 запросов |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  const k = (s, kind) => s.byKind[kind] ? `${s.byKind[kind].ok}/${s.byKind[kind].n}` : "-";
  for (const s of sums) console.log(`| ${s.model} | ${s.ok}/${s.n} | ${k(s, "tool")} | ${k(s, "no_tool")} | ${k(s, "final")} | ${k(s, "json")} | ${(s.p50 / 1000).toFixed(1)} | ${(s.p95 / 1000).toFixed(1)} | ${s.avgIn}/${s.avgOut} | ${s.cost1k == null ? "?" : s.cost1k.toFixed(0)} |`);
  console.log("\nПровалы:");
  for (const m of models) for (const r of all[m].filter(r => !r.ok)) console.log(`- ${m} / ${r.case}#${r.run}: ${r.issues.join("; ")}`);
  fs.mkdirSync(path.join(here, "out"), { recursive: true });
  const file = path.join(here, "out", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ base: BASE, cmd, prompt: PROMPT_VARIANT, summaries: sums, results: all }, null, 2));
  console.log(`\nСырые ответы: ${file}`);
} else {
  console.log("Команды: models | smoke --models ... | run --models ... [--repeat N] [--only t-,n-,f-,j-]");
}
