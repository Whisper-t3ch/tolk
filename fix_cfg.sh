sed -i 's/"config.prejoinPageEnabled=false",/"config.prejoinPageEnabled=false", "config.videoQuality.codecPreferenceOrder=%5B%22VP8%22%5D", "config.disableSimulcast=true", "config.constraints.video.height.ideal=360", "config.constraints.video.height.max=360", "config.constraints.video.frameRate.max=15",/' ~/jitsi/jitsi_load.mjs
grep -c 'disableSimulcast' ~/jitsi/jitsi_load.mjs
