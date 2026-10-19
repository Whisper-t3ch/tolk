import { chromium } from "playwright";
const ARGS = ["--no-sandbox","--disable-gpu","--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream","--autoplay-policy=no-user-gesture-required","--disable-dev-shm-usage","--mute-audio"];
const run = Math.random().toString(36).slice(2, 8);
const cfg = ["config.prejoinConfig.enabled=false","config.prejoinPageEnabled=false","config.startWithAudioMuted=false","config.startWithVideoMuted=false","config.disableDeepLinking=true","config.p2p.enabled=false"].join("&");
const b = await chromium.launch({ headless: true, args: ARGS });
const pages = [];
for (let i = 0; i < 2; i++) {
  const c = await b.newContext({ permissions: ["camera", "microphone"] });
  const p = await c.newPage();
  p.on("console", m => { if (/error|fail|NotAllowed|NotFound/i.test(m.text())) console.log("console[" + i + "]", m.text().slice(0, 200)); });
  await p.goto("https://meet.tolkplace.ru/diag-" + run + "#" + cfg, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.APP && APP.conference && APP.conference._room, null, { timeout: 60000 });
  pages.push(p);
}
await new Promise(r => setTimeout(r, 30000));
for (const [i, p] of pages.entries()) {
  const r = await p.evaluate(async () => {
    const tr = APP.store.getState()["features/base/tracks"] || [];
    const local = tr.filter(t => t.local).map(t => ({ type: t.mediaType, videoType: t.videoType, muted: t.muted, hasJitsi: !!t.jitsiTrack, ready: t.jitsiTrack && t.jitsiTrack.track && t.jitsiTrack.track.readyState }));
    let bytes = null;
    try {
      const pc = APP.conference._room.getActivePeerConnection();
      const rep = await (pc.peerconnection || pc).getStats();
      bytes = [];
      rep.forEach(s => { if (s.type === "outbound-rtp") bytes.push({ kind: s.kind, bytesSent: s.bytesSent, packets: s.packetsSent }); });
    } catch (e) { bytes = "err " + e; }
    return { local, bytes, p2p: APP.conference._room.isP2PActive() };
  });
  console.log("participant", i, JSON.stringify(r));
}
await b.close();
