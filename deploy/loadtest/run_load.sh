#!/usr/bin/env bash
# Сценарий «совместная нагрузка» НА ASR-ВМ: Supabase + сайт + ASR одновременно, с замером и оценкой критериев K1–K7.
#   ./run_load.sh <audio_file> [users=20] [minutes=12] [speed=1]
# Этапы: 1) тишина 60 с  2) ASR baseline x3 (БД/сайт простаивают)  3) нагрузка Supabase + ASR loaded x3  4) пауза  5) burst: 4 ASR-задачи сразу (очередь)
# Результаты: ~/loadtest/results/<время>/ (stack_metrics.csv, sb_metrics.csv, asr_jobs.csv, asr_burst.csv, load_report.txt, verdict.txt).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
AUDIO="${1:?аудиофайл}"; USERS="${2:-20}"; MIN="${3:-12}"; SPEED="${4:-1}"
AS="$HOME/asr-service"; TS="$(date -u +%Y%m%dT%H%M%SZ)"; DIR="$HERE/results/$TS"; mkdir -p "$DIR"
echo "Результаты: $DIR"
cleanup() { pkill -f "monitor_stack.sh" 2>/dev/null; [ -n "${SBPID:-}" ] && kill "$SBPID" 2>/dev/null; }
trap cleanup EXIT

nohup "$AS/monitor_stack.sh" 5 stage.tolkplace.ru "$DIR/stack_metrics.csv" >/dev/null 2>&1 &
( echo "ts,name,cpu_pct,mem"; while true; do
    sudo docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}' 2>/dev/null | grep -E '^supabase-' | sed "s/^/$(date -u +%Y-%m-%dT%H:%M:%SZ),/" | tr -d '%'
    sleep 5; done ) > "$DIR/sb_metrics.csv" 2>/dev/null &
SBPID=$!

echo "== 1/5 тишина 60 с (фон без нагрузки)"; sleep 60
echo "== 2/5 ASR baseline x3 (сайт и БД простаивают)"
OUT="$DIR/asr_jobs.csv" "$HERE/asr_bench.sh" baseline "$AUDIO" 3
echo "== 3/5 нагрузка Supabase ($USERS психологов, $MIN мин) + ASR loaded x3"
python3 "$HERE/supabase_load.py" --users "$USERS" --minutes "$MIN" --speed "$SPEED" > "$DIR/load_report.txt" 2>&1 &
LPID=$!
sleep 90   # дать пользователям создаться и выйти на режим
OUT="$DIR/asr_jobs.csv" "$HERE/asr_bench.sh" loaded "$AUDIO" 3
wait "$LPID"; LRC=$?
echo "== 4/5 пауза 60 с"; sleep 60
echo "== 5/5 burst: 4 задачи ASR одновременно (очередь, ASR_MAX_CONCURRENCY)"
OUT="$DIR/asr_burst.csv" "$HERE/asr_bench.sh" burst "$AUDIO" 4 4
pkill -f monitor_stack.sh 2>/dev/null; kill "$SBPID" 2>/dev/null; SBPID=""

echo; echo "===== ОТЧЁТ SUPABASE-НАГРУЗКИ ====="; cat "$DIR/load_report.txt" | tr '\r' '\n' | grep -v '^  прошло' 
echo; echo "===== КРИТЕРИИ K1–K7 ====="
python3 "$AS/evaluate_criteria.py" "$DIR/stack_metrics.csv" --asr-jobs "$DIR/asr_jobs.csv" | tee "$DIR/verdict.txt"
echo; echo "===== КОНТЕЙНЕРЫ SUPABASE (CPU %, пик и среднее) ====="
python3 - "$DIR/sb_metrics.csv" <<'PY'
import csv,sys,collections
d=collections.defaultdict(list)
for r in csv.DictReader(open(sys.argv[1])):
    try: d[r["name"]].append(float(r["cpu_pct"]))
    except Exception: pass
for k,v in sorted(d.items()): print(f"{k:<18} среднее {sum(v)/len(v):6.1f}%   пик {max(v):6.1f}%   замеров {len(v)}")
PY
echo; echo "===== ASR: время задач ====="
for f in asr_jobs.csv asr_burst.csv; do echo "-- $f"; cat "$DIR/$f" 2>/dev/null; done
echo; echo "Код нагрузки Supabase: $LRC (0 = ошибок < 1%)"
