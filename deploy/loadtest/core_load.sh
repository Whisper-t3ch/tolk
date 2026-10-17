#!/usr/bin/env bash
# Нагрузка на ЯДРО (core, без ASR): N психологов пишут сессию в self-hosted Supabase. Запуск НА core.
#   ./core_load.sh [users=20] [minutes=12] [speed=1]
# Меряет: CPU ВМ (us+sy), steal, load1, RAM, CPU контейнеров Supabase, ответы API (supabase_load.py).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
USERS="${1:-20}"; MIN="${2:-12}"; SPEED="${3:-1}"
URL="${LOAD_URL:-http://172.17.0.1:8000}"
DIR="$HERE/results/core_$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$DIR"; echo "Результаты: $DIR"
D="docker"; docker ps >/dev/null 2>&1 || D="sudo docker"
cleanup() { kill $VPID $SPID 2>/dev/null; }; trap cleanup EXIT
vmstat -n 5 > "$DIR/vmstat.txt" & VPID=$!
( while true; do $D stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}' 2>/dev/null | grep -E '^(supabase|jitsi)-' | sed "s/^/$(date -u +%H:%M:%S),/" | tr -d '%'; sleep 5; done ) > "$DIR/sb_metrics.csv" & SPID=$!
echo "== тишина 60 с"; sleep 60
echo "== нагрузка: $USERS психологов, $MIN мин, speed $SPEED, $URL"
python3 "$HERE/supabase_load.py" --users "$USERS" --minutes "$MIN" --speed "$SPEED" --url "$URL" 2>&1 | tr '\r' '\n' | grep -v '^  прошло' | tee "$DIR/load_report.txt"
RC=${PIPESTATUS[0]}
sleep 30; kill $VPID $SPID 2>/dev/null
echo; echo "===== VM (vmstat, 5 с) ====="
python3 - "$DIR/vmstat.txt" <<'PY'
import sys
rows=[l.split() for l in open(sys.argv[1]) if l.strip() and l.split()[0].isdigit()]
rows=rows[1:]  # первая строка — среднее с загрузки
cpu=[int(r[12])+int(r[13]) for r in rows]; st=[int(r[16]) for r in rows]
# окно нагрузки: всё, где cpu заметно выше фона — берём всё, плюс пик скользящих 60 с
w=12; roll=[sum(cpu[i:i+w])/w for i in range(max(1,len(cpu)-w+1))]
print(f"замеров {len(cpu)}  CPU среднее {sum(cpu)/len(cpu):.1f}%  пик 5с {max(cpu)}%  пик rolling-60с {max(roll):.1f}%")
print(f"steal среднее {sum(st)/len(st):.2f}%  макс {max(st)}%")
PY
free -m | sed -n 1,2p
echo; echo "===== КОНТЕЙНЕРЫ SUPABASE И JITSI (CPU %, 100% = 1 ядро) ====="
python3 - "$DIR/sb_metrics.csv" <<'PY'
import csv,sys,collections
d=collections.defaultdict(list)
for r in csv.reader(open(sys.argv[1])):
    try: d[r[1]].append(float(r[2]))
    except Exception: pass
for k,v in sorted(d.items()): print(f"{k:<22} среднее {sum(v)/len(v):6.1f}%  пик {max(v):6.1f}%")
PY
echo; echo "Код нагрузки: $RC (0 = ошибок < 1%)"
