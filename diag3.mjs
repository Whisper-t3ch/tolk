import { chromium } from "playwright";
const ARGS = ["--no-sandbox","--disable-gpu","--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream","--autoplay-policy=no-user-gesture-required","--disable-dev-shm-usage","--mute-audio"];
const cfg = ["config.prejoinConfig.enabled=false","config.prejoinPageEnabled=false","config.disableDeepLinking=true","config.p2p.enabled=false"].join("&");
const run = Math.random().toString(36).slice(2, 8);
const b = await chromium.launch({ headless: true, args: ARGS });
const pages = [];
for (let i = 0; i < 2; i++) {
  const c = await b.newContext({ permissions: ["camera", "microphone"] });
  const p = await c.newPage();
  await p.goto("https://meet.tolkplace.ru/diag3-" + run + "#" + cfg, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.APP && APP.conference && APP.conference._room, null, { timeout: 60000 });
  pages.push(p);
}
await new Promise(r => setTimeout(r, 5000));
for (const [i, p] of pages.entries()) {
  const log = await p.evaluate(async () => {
    const log = [typeof APP.conference.muteAudio, typeof APP.conference.muteVideo];
    try { await APP.conference.muteAudio(true); await APP.conference.muteAudio(false); log.push("a-ok"); } catch (e) { log.push("a-err " + e); }
    try { await APP.conference.muteVideo(true); await APP.conference.muteVideo(false); log.push("v-ok"); } catch (e) { log.push("v-err " + e); }
    return log;
  });
  console.log("unmute", i, JSON.stringify(log));
}
await new Promise(r => setTimeout(r, 15000));
for (const [i, p] of pages.entries()) {
  const r = await p.evaluate(async () => {
    const tr = APP.store.getState()["features/base/tracks"] || [];
    const local = tr.filter(t => t.local).map(t => ({ type: t.mediaType, muted: t.muted, ready: t.jitsiTrack && t.jitsiTrack.track && t.jitsiTrack.track.readyState }));
    let bytes = null;
    try {
      const pc = APP.conference._room.getActivePeerConnection();
      const rep = await (pc.peerconnection || pc).getStats();
      bytes = [];
      rep.forEach(s => { if (s.type === "outbound-rtp") bytes.push({ kind: s.kind, bytesSent: s.bytesSent }); });
    } catch (e) { bytes = "err " + e; }
    return { local, bytes };
  });
  console.log("participant", i, JSON.stringify(r));
}
await b.close();
