#!/usr/bin/env node
// Нагрузка на Jitsi: N комнат по K участников (психолог + клиент), настоящие браузеры Chromium с фейковой камерой/микрофоном.
// Запуск НА ОТДЕЛЬНОЙ машине-генераторе (не на ВМ Jitsi и не на ASR-ВМ):
//   node jitsi_load.mjs --domain meet.tolkplace.ru --rooms 7 --per-room 2 --minutes 5 --p2p on|off [--ramp 60] [--out jitsi_run.jsonl]
// p2p on  = как в TOLK (на 2 участниках медиа идёт напрямую, сервер почти не нагружается)
// p2p off = худший случай (весь трафик через JVB); на клиентах отключается через config.p2p.enabled=false
// Каждые 10 с пишет в консоль и в JSONL: сколько участников подключено, сколько комнат с полным составом,
// сколько соединений идут напрямую (P2P) и CPU самого генератора. Если CPU генератора > 90% дольше 60 с — прогон помечается НЕВАЛИДНЫМ
// (измеряли бы генератор, а не сервер). Серверные метрики снимает vm_load_monitor.sh на ВМ Jitsi.
import { chromium } from "playwright";
import os from "node:os";
import fs from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > -1 ? process.argv[i + 1] : d; };
const DOMAIN = arg("domain", "meet.tolkplace.ru");
const ROOMS = +arg("rooms", 7);
const PER = +arg("per-room", 2);
const MINUTES = +arg("minutes", 5);
const P2P = arg("p2p", "on") === "on";
const RAMP = +arg("ramp", 60);
const OUT = arg("out", `jitsi_run_${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
const PER_BROWSER = +arg("per-browser", 10);   // участников на один процесс Chromium
const RUN = Math.random().toString(36).slice(2, 8);

const log = (o) => { const line = JSON.stringify({ t: new Date().toISOString(), ...o }); console.log(line); fs.appendFileSync(OUT, line + "\n"); };

// CPU генератора
let prevCpu = os.cpus().map((c) => ({ ...c.times }));
function cpuPct() {
  const cur = os.cpus().map((c) => ({ ...c.times }));
  let busy = 0, total = 0;
  cur.forEach((c, i) => { const p = prevCpu[i]; const d = (k) => c[k] - p[k]; const idle = d("idle"); const all = d("user") + d("nice") + d("sys") + d("irq") + idle; busy += all - idle; total += all; });
  prevCpu = cur; return total ? +(100 * busy / total).toFixed(1) : 0;
}

const ARGS = ["--no-sandbox", "--disable-gpu", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage", "--mute-audio", "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"];

const participants = []; // {room, idx, page, joined, err}
const browsers = [];

function url(room, name) {
  const cfg = [
    "config.prejoinConfig.enabled=false", "config.prejoinPageEnabled=false",
    "config.startWithAudioMuted=false", "config.startWithVideoMuted=false",
    "config.disableDeepLinking=true", "config.requireDisplayName=false",
    `config.p2p.enabled=${P2P ? "true" : "false"}`,
    `userInfo.displayName=%22${encodeURIComponent(name)}%22`,
  ].join("&");
  return `https://${DOMAIN}/loadtest-${RUN}-${room}#${cfg}`;
}

async function joinOne(browser, room, idx) {
  const rec = { room, idx, page: null, joined: false, err: null, joinMs: null };
  participants.push(rec);
  const t0 = Date.now();
  try {
    const ctx = await browser.newContext({ permissions: ["camera", "microphone"], ignoreHTTPSErrors: false });
    const page = await ctx.newPage();
    rec.page = page;
    await page.goto(url(room, `Load-${room}-${idx}`), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.APP && APP.conference && APP.conference._room, null, { timeout: 60000 });
    rec.joined = true; rec.joinMs = Date.now() - t0;
  } catch (e) { rec.err = String(e).slice(0, 160); }
}

async function snapshot() {
  const perRoom = new Map();
  let joined = 0, p2pActive = 0, failed = 0;
  await Promise.all(participants.map(async (p) => {
    if (p.err) { failed++; return; }
    if (!p.joined || !p.page) return;
    try {
      const r = await p.page.evaluate(() => {
        const room = APP.conference._room;
        let members = null;
        try { const rem = APP.store.getState()["features/base/participants"].remote; members = (rem.size ?? Object.keys(rem).length) + 1; } catch (e) { /* другая версия клиента */ }
        if (members === null) members = (APP.conference.membersCount ?? 0) + 1;
        return { members, p2p: !!(room.isP2PActive && room.isP2PActive()) };
      });
      joined++; if (r.p2p) p2pActive++;
      perRoom.set(p.room, Math.max(perRoom.get(p.room) || 0, r.members));
    } catch { /* вкладка ещё грузится */ }
  }));
  const full = [...perRoom.values()].filter((m) => m >= PER).length;
  return { joined, failed, roomsFull: full, p2pActive };
}

async function main() {
  const total = ROOMS * PER;
  log({ event: "start", run: RUN, domain: DOMAIN, rooms: ROOMS, perRoom: PER, participants: total, minutes: MINUTES, p2p: P2P, cpus: os.cpus().length });
  const nBrowsers = Math.ceil(total / PER_BROWSER);
  for (let b = 0; b < nBrowsers; b++) browsers.push(await chromium.launch({ headless: true, args: ARGS }));

  // растягиваем подключение комнат на RAMP секунд
  const joins = [];
  let k = 0;
  for (let r = 0; r < ROOMS; r++) {
    for (let i = 0; i < PER; i++) {
      const delay = (RAMP * 1000 * r) / Math.max(1, ROOMS);
      const br = browsers[k++ % browsers.length];
      joins.push(new Promise((res) => setTimeout(() => joinOne(br, r, i).then(res), delay + i * 800)));
    }
  }
  const tEnd = Date.now() + RAMP * 1000 + MINUTES * 60 * 1000;
  let hot = 0, invalid = false;
  const ticker = setInterval(async () => {
    const cpu = cpuPct(); hot = cpu > 90 ? hot + 10 : 0; if (hot > 60) invalid = true;
    const s = await snapshot();
    log({ event: "tick", generatorCpuPct: cpu, load1: +os.loadavg()[0].toFixed(2), ...s, expected: total, invalidGenerator: invalid });
  }, 10000);
  await Promise.all(joins);
  const joinTimes = participants.filter((p) => p.joinMs).map((p) => p.joinMs).sort((a, b) => a - b);
  const q = (x) => joinTimes.length ? joinTimes[Math.min(joinTimes.length - 1, Math.floor(x * joinTimes.length))] : null;
  log({ event: "all-join-attempts-done", ok: participants.filter((p) => p.joined).length, failed: participants.filter((p) => p.err).length, joinMsP50: q(0.5), joinMsP95: q(0.95), errors: [...new Set(participants.filter((p) => p.err).map((p) => p.err))].slice(0, 5) });
  while (Date.now() < tEnd) await new Promise((r) => setTimeout(r, 1000));
  clearInterval(ticker);
  const s = await snapshot();
  log({ event: "end", ...s, expected: total, invalidGenerator: invalid, note: invalid ? "ПРОГОН НЕВАЛИДЕН: генератор перегружен, уменьшите число участников" : "ok" });
  for (const b of browsers) await b.close().catch(() => {});
  process.exit(invalid ? 2 : 0);
}
main().catch((e) => { log({ event: "fatal", error: String(e) }); process.exit(1); });
