// Запускается ВНУТРИ контейнера web (там переменные LLM_* и сертификаты Минцифры).
// stdin: строки JSON {kind:"kb"|"chunk", id, text} или {kind:"transcript", session_id, text}.
// stdout: SQL для psql (UPDATE эмбеддингов / INSERT чанков). Ошибки — в stderr.
import { randomUUID } from "node:crypto";
import readline from "node:readline";

const BASE = (process.env.LLM_BASE_URL || "https://gigachat.devices.sberbank.ru/api/v1").replace(/\/+$/, "");
const OAUTH = process.env.LLM_OAUTH_URL || "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const MODEL = process.env.LLM_EMBEDDINGS_MODEL || "Embeddings";
const MAX = Number(process.env.LLM_EMBEDDINGS_MAX_CHARS || 1500);
const CHUNK = 1050, OVERLAP = 140; // как в src/lib/transcriptChunking.ts

let token = null, tokenExp = 0;
async function auth() {
  if (process.env.LLM_AUTH !== "gigachat_oauth") return `Bearer ${process.env.LLM_API_KEY}`;
  if (token && tokenExp - Date.now() > 60000) return `Bearer ${token}`;
  const r = await fetch(OAUTH, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", RqUID: randomUUID(), Authorization: `Basic ${process.env.LLM_API_KEY}` },
    body: new URLSearchParams({ scope: process.env.LLM_OAUTH_SCOPE || "GIGACHAT_API_PERS" }).toString(),
  });
  if (!r.ok) throw new Error(`OAuth ${r.status}`);
  const j = await r.json();
  token = j.access_token; tokenExp = Number(j.expires_at) || Date.now() + 25 * 60000;
  return `Bearer ${token}`;
}
async function embed(text) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${BASE}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: await auth() },
      body: JSON.stringify({ model: MODEL, input: [text.slice(0, MAX)] }),
    });
    if (r.ok) { const j = await r.json(); return j.data[0].embedding; }
    if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 1500 * (attempt + 1))); continue; }
    throw new Error(`embeddings ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  throw new Error("embeddings: попытки исчерпаны");
}
function split(text) {
  const t = text.trim();
  if (t.length <= CHUNK) return [t];
  const out = []; let start = 0;
  while (start < t.length) {
    const end = Math.min(start + CHUNK, t.length);
    let cut = end;
    if (end < t.length) { const nl = t.lastIndexOf("\n", end); if (nl > start + CHUNK * 0.5) cut = nl; }
    out.push(t.slice(start, cut).trim());
    if (cut >= t.length) break;
    start = Math.max(cut - OVERLAP, start + 1);
  }
  return out.filter(Boolean);
}
const vec = e => `'[${e.join(",")}]'`;
const q = s => { const tag = "$t" + randomUUID().replace(/-/g, "").slice(0, 8) + "$"; return tag + s + tag; };

let ok = 0, fail = 0, dims = 0;
const rl = readline.createInterface({ input: process.stdin });
console.log("begin;");
for await (const line of rl) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  try {
    if (row.kind === "kb") {
      const e = await embed(row.text); dims = e.length;
      console.log(`update public.knowledge_base set embedding = ${vec(e)} where id = '${row.id}';`); ok++;
    } else if (row.kind === "chunk") {
      const e = await embed(row.text); dims = e.length;
      console.log(`update public.session_transcript_chunks set embedding = ${vec(e)} where id = '${row.id}';`); ok++;
    } else if (row.kind === "transcript") {
      console.log(`delete from public.session_transcript_chunks where session_id = '${row.session_id}';`);
      const parts = split(row.text);
      for (let i = 0; i < parts.length; i++) {
        const e = await embed(parts[i]); dims = e.length;
        console.log(`insert into public.session_transcript_chunks (session_id, chunk_index, chunk_text, embedding) values ('${row.session_id}', ${i}, ${q(parts[i])}, ${vec(e)});`); ok++;
      }
    }
  } catch (err) { fail++; console.error("FAIL", row.kind, row.id || row.session_id, String(err.message || err)); }
}
console.log("commit;");
console.error(`Готово: эмбеддингов ${ok}, ошибок ${fail}, размерность ${dims}`);
