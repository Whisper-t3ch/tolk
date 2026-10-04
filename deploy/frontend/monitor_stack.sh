#!/usr/bin/env bash
# Сбор метрик совместной нагрузки (frontend + ASR) НА ВМ. Запуск из ~/asr-service:
#   nohup ./monitor_stack.sh 5 stage.tolkplace.ru > /dev/null 2>&1 &    # шаг 5 с; остановка: kill %1 / pkill -f monitor_stack
# Пишет stack_metrics.csv. Секретов не читает. Оценка: python3 evaluate_criteria.py stack_metrics.csv
set -u
INT="${1:-5}"; HOST="${2:-stage.tolkplace.ru}"; OUT="${3:-stack_metrics.csv}"
NCPU="$(nproc)"
[ -f "$OUT" ] || echo "ts,ncpu,cpu_pct,load1,load5,load15,mem_total_mb,mem_avail_mb,swap_used_mb,asr_cpu_pct,web_cpu_pct,caddy_cpu_pct,asr_mem_mb,web_mem_mb,restarts_total,oom_any,ttfb_login_s,http_login,ttfb_health_s,http_health" > "$OUT"
read_cpu() { awk '/^cpu /{print $2+$3+$4+$7+$8, $2+$3+$4+$5+$6+$7+$8}' /proc/stat; }
read -r b0 t0 < <(read_cpu)
cid() { sudo docker ps -q --filter "name=$1" | head -1; }
while true; do
  sleep "$INT"
  read -r b1 t1 < <(read_cpu)
  cpu=$(awk -v b0=$b0 -v t0=$t0 -v b1=$b1 -v t1=$t1 'BEGIN{d=t1-t0; if(d>0) printf "%.1f",100*(b1-b0)/d; else print ""}'); b0=$b1; t0=$t1
  read -r l1 l5 l15 _ < /proc/loadavg
  mt=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo); ma=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
  sw=$(awk '/SwapTotal/{t=$2}/SwapFree/{f=$2}END{print int((t-f)/1024)}' /proc/meminfo)
  st=$(sudo docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}' 2>/dev/null)
  pick() { echo "$st" | grep -i "$1" | head -1; }
  acpu=$(pick asr | cut -d, -f2 | tr -d '%'); wcpu=$(pick web | cut -d, -f2 | tr -d '%'); ccpu=$(pick caddy | cut -d, -f2 | tr -d '%')
  amem=$(pick asr | cut -d, -f3 | cut -d/ -f1 | tr -d ' ' | sed 's/MiB//;s/GiB/*1024/' | bc 2>/dev/null)
  wmem=$(pick web | cut -d, -f3 | cut -d/ -f1 | tr -d ' ' | sed 's/MiB//;s/GiB/*1024/' | bc 2>/dev/null)
  restarts=0; oom=0
  for n in asr web caddy; do
    id=$(cid "$n"); [ -n "$id" ] || continue
    r=$(sudo docker inspect -f '{{.RestartCount}}' "$id" 2>/dev/null || echo 0); restarts=$((restarts + r))
    [ "$(sudo docker inspect -f '{{.State.OOMKilled}}' "$id" 2>/dev/null)" = "true" ] && oom=1
  done
  m1=$(curl -s -o /dev/null -m 10 -w '%{time_starttransfer},%{http_code}' --resolve "$HOST:443:127.0.0.1" "https://$HOST/login" || echo ",000")
  m2=$(curl -s -o /dev/null -m 10 -w '%{time_starttransfer},%{http_code}' --resolve "$HOST:443:127.0.0.1" "https://$HOST/api/health" || echo ",000")
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ),$NCPU,$cpu,$l1,$l5,$l15,$mt,$ma,$sw,$acpu,$wcpu,$ccpu,$amem,$wmem,$restarts,$oom,$m1,$m2" >> "$OUT"
done
