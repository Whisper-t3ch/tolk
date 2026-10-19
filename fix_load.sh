sed -i 's/rec.joined = true; rec.joinMs = Date.now() - t0;/await page.evaluate(async () => { await APP.conference.muteAudio(true); await APP.conference.muteAudio(false); await APP.conference.muteVideo(true); await APP.conference.muteVideo(false); }); rec.joined = true; rec.joinMs = Date.now() - t0;/' ~/jitsi/jitsi_load.mjs
grep -c 'muteVideo(false)' ~/jitsi/jitsi_load.mjs
