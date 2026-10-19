#!/bin/bash
# Нагрузочный мониторинг ВМ в динамике — для теста из плана 27.09
# (3-4 параллельные сессии). Запускать НА САМОЙ ВМ (self-hosted Jitsi),
# параллельно с тестовыми звонками, в отдельном tmux/screen-окне:
#
#   chmod +x vm_load_monitor.sh
#   ./vm_load_monitor.sh > /dev/null 2>&1 &
#   # ... прогоняем тестовые звонки ...
#   kill %1   # остановить, когда тест закончен
#
# Пишет одну строку в secunds в load_log.csv: время, CPU каждого
# jitsi-контейнера (web/prosody/jicofo/jvb), суммарная память, сетевой
# трафик хоста, и — самое важное для оценки реальной нагрузки звонков,
# а не только "CPU занят" — число активных conference/participants из
# собственного REST API видеобриджа (colibri stats), который Jitsi
# отдаёт бесплатно и в реальном времени.
#
# После теста колонки colibri_conferences/colibri_participants/
# colibri_bitrate_down_kbps покажут, сколько звонков реально шло через
# JVB (relay), а не P2P — это и есть ответ на вопрос "какая реальная
# нагрузка", а не просто "сервер не упал".

set -u
INTERVAL_SEC="${1:-5}"
OUT="load_log.csv"
JVB_STATS_URL="http://localhost:8080/colibri/stats"  # порт по умолчанию в docker-jitsi-meet; если другой — поправьте здесь

if [ ! -f "$OUT" ]; then
  echo "ts,cpu_web_pct,cpu_prosody_pct,cpu_jicofo_pct,cpu_jvb_pct,mem_jvb_mib,net_rx_mbps,net_tx_mbps,colibri_conferences,colibri_participants,colibri_bitrate_down_kbps,colibri_bitrate_up_kbps" > "$OUT"
fi

prev_rx=0
prev_tx=0
iface=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $5; exit}')

while true; do
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # docker stats --no-stream один проход, парсим CPU%/MEM по имени контейнера
  stats=$(docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}' 2>/dev/null)
  cpu_web=$(echo "$stats" | grep -i "web" | head -1 | cut -d, -f2 | tr -d '%')
  cpu_prosody=$(echo "$stats" | grep -i "prosody" | head -1 | cut -d, -f2 | tr -d '%')
  cpu_jicofo=$(echo "$stats" | grep -i "jicofo" | head -1 | cut -d, -f2 | tr -d '%')
  cpu_jvb=$(echo "$stats" | grep -i "jvb" | head -1 | cut -d, -f2 | tr -d '%')
  mem_jvb=$(echo "$stats" | grep -i "jvb" | head -1 | cut -d, -f3 | cut -d/ -f1 | tr -d ' ' | sed 's/MiB//')

  # сетевой трафик хоста (суммарно, не только Jitsi) — грубая оценка bandwidth
  if [ -n "$iface" ] && [ -f "/sys/class/net/$iface/statistics/rx_bytes" ]; then
    rx=$(cat "/sys/class/net/$iface/statistics/rx_bytes")
    tx=$(cat "/sys/class/net/$iface/statistics/tx_bytes")
    rx_mbps=$(echo "scale=2; ($rx-$prev_rx)*8/1000000/$INTERVAL_SEC" | bc 2>/dev/null)
    tx_mbps=$(echo "scale=2; ($tx-$prev_tx)*8/1000000/$INTERVAL_SEC" | bc 2>/dev/null)
    prev_rx=$rx; prev_tx=$tx
  else
    rx_mbps=""; tx_mbps=""
  fi

  # colibri REST stats видеобриджа — реальная occupancy, не только OS CPU
  colibri=$(curl -s --max-time 2 "$JVB_STATS_URL" 2>/dev/null)
  conferences=$(echo "$colibri" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('conferences',''))" 2>/dev/null)
  participants=$(echo "$colibri" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('participants',''))" 2>/dev/null)
  bitrate_down=$(echo "$colibri" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('bit_rate_download',''))" 2>/dev/null)
  bitrate_up=$(echo "$colibri" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('bit_rate_upload',''))" 2>/dev/null)

  echo "$ts,$cpu_web,$cpu_prosody,$cpu_jicofo,$cpu_jvb,$mem_jvb,$rx_mbps,$tx_mbps,$conferences,$participants,$bitrate_down,$bitrate_up" >> "$OUT"
  sleep "$INTERVAL_SEC"
done
