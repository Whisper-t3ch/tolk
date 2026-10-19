#!/usr/bin/env bash
# Монитор Jitsi-ВМ: CPU хоста и контейнеров, сеть, метрики JVB (/metrics). Запуск: ./vm_load_monitor.sh [out.csv] [интервал_сек]
OUT="${1:-load_log.csv}"; INT="${2:-5}"
URL="http://localhost:8080/metrics"
IF=$(ip route show default | awk '{print $5; exit}')
echo "ts,cpu_host_pct,cpu_web_pct,cpu_prosody_pct,cpu_jicofo_pct,cpu_jvb_pct,mem_jvb_mib,net_rx_mbps,net_tx_mbps,conferences,endpoints,endpoints_sending_video,endpoints_sending_audio,conferences_p2p,jvb_stress" > "$OUT"
read_net(){ sed 's/:/ /' /proc/net/dev | awk -v i="$IF" '$1==i{print $2, $10}'; }
read_cpu(){ awk '/^cpu /{t=0; for(i=2;i<=NF;i++) t+=$i; print $5+$6, t}' /proc/stat; }
read pi pt <<<"$(read_cpu)"; read prx ptx <<<"$(read_net)"; pnow=$(date +%s.%N)
while true; do
  sleep "$INT"
  now=$(date +%s.%N); read ci ct <<<"$(read_cpu)"; read rx tx <<<"$(read_net)"
  ds=$(sudo docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' 2>/dev/null)
  m=$(curl -s --max-time 3 "$URL")
  host=$(awk -v ci=$ci -v ct=$ct -v pi=$pi -v pt=$pt 'BEGIN{d=ct-pt; printf "%.1f", d>0?100*(1-(ci-pi)/d):0}')
  net=$(awk -v rx=$rx -v tx=$tx -v prx=$prx -v ptx=$ptx -v n=$now -v p=$pnow 'BEGIN{d=n-p; if(d<=0)d=1; printf "%.2f,%.2f", (rx-prx)*8/d/1e6, (tx-ptx)*8/d/1e6}')
  cpu(){ echo "$ds" | awk -v n="$1" '$1 ~ n {gsub("%","",$2); print $2; f=1} END{if(!f)print 0}'; }
  mem=$(echo "$ds" | awk '$1 ~ /jvb/ {v=$3; u=v; gsub(/[0-9.]/,"",u); gsub(/[A-Za-z]/,"",v); if(u ~ /GiB/) v=v*1024; else if(u ~ /KiB/) v=v/1024; printf "%.0f", v}')
  g(){ echo "$m" | awk -v k="$1" '$1==k{print $2; f=1} END{if(!f)print ""}'; }
  echo "$(date -u +%FT%TZ),$host,$(cpu jitsi-web),$(cpu prosody),$(cpu jicofo),$(cpu jvb),$mem,$net,$(g jitsi_jvb_conferences),$(g jitsi_jvb_current_endpoints),$(g jitsi_jvb_endpoints_sending_video),$(g jitsi_jvb_endpoints_sending_audio),$(g jitsi_jvb_conferences_p2p),$(g jitsi_jvb_stress)" >> "$OUT"
  pi=$ci; pt=$ct; prx=$rx; ptx=$tx; pnow=$now
done
