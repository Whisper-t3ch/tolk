sed -i 's/"config.startWithAudioMuted=false"/"config.disableInitialGUM=false","config.startWithAudioMuted=false"/' ~/jitsi/jitsi_load.mjs ~/jitsi/diag.mjs
grep -c disableInitialGUM ~/jitsi/jitsi_load.mjs ~/jitsi/diag.mjs
cd ~/jitsi && node diag.mjs 2>&1 | grep '^participant'
