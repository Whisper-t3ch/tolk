import { chromium } from "playwright";
const ARGS = ["--no-sandbox","--disable-gpu","--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream","--autoplay-policy=no-user-gesture-required","--disable-dev-shm-usage","--mute-audio"];
const cfg = ["config.prejoinConfig.enabled=false","config.prejoinPageEnabled=false","config.startWithAudioMuted=false","config.startWithVideoMuted=false","config.disableDeepLinking=true","config.p2p.enabled=false"].join("&");
const b = await chromium.launch({ headless: true, args: ARGS });
const c = await b.newContext({ permissions: ["camera", "microphone"] });
const p = await c.newPage();
await p.goto("https://meet.tolkplace.ru/diag2-" + Math.random().toString(36).slice(2, 8) + "#" + cfg, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.APP && APP.conference && APP.conference._room, null, { timeout: 60000 });
await new Promise(r => setTimeout(r, 15000));
const r = await p.evaluate(async () => {
  const st = APP.store.getState();
  const cf = st["features/base/config"];
  const out = { cfg: { disableInitialGUM: cf.disableInitialGUM, startWithAudioMuted: cf.startWithAudioMuted, startWithVideoMuted: cf.startWithVideoMuted, startSilent: cf.startSilent, prejoin: cf.prejoinConfig, p2p: cf.p2p && cf.p2p.enabled }, media: st["features/base/media"], tracks: (st["features/base/tracks"] || []).length };
  try { const ds = await navigator.mediaDevices.enumerateDevices(); out.devices = ds.map(d => d.kind + ":" + d.label.slice(0, 25)); } catch (e) { out.devices = "err " + e; }
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); out.gum = s.getTracks().map(t => t.kind + ":" + t.readyState); s.getTracks().forEach(t => t.stop()); } catch (e) { out.gum = "err " + e; }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await b.close();
