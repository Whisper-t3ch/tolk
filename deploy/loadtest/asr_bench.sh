#!/usr/bin/env bash
# Замер скорости ASR на одном аудиофайле. Запуск НА ASR-ВМ.
#   ./asr_bench.sh <phase> <audio_file> [count=3] [parallel=1]
# phase: baseline (сайт/БД простаивают) | loaded (идёт нагрузка) | burst (параллельно, смотрим очередь)
# Пишет строки "phase,audio_sec,job_sec" в $OUT (по умолчанию asr_jobs.csv) — формат для evaluate_criteria.py.
# job_sec = полное время HTTP-запроса (включая ожидание в очереди: сервис обрабатывает ASR_MAX_CONCURRENCY задач за раз).
# Токен читается из ~/asr-service/.env и НЕ печатается.
set -euo pipefail
PHASE="${1:?phase}"; AUDIO="${2:?audio file}"; COUNT="${3:-3}"; PAR="${4:-1}"
ENVF="${ASR_ENV:-$HOME/asr-service/.env}"; HOST="${ASR_HOST:-asr.tolkplace.ru}"; OUT="${OUT:-asr_jobs.csv}"
[ -f "$AUDIO" ] || { echo "Нет файла $AUDIO"; exit 1; }
TOK="$(grep -E '^ASR_SERVICE_TOKEN=' "$ENVF" | head -1 | cut -d= -f2- | tr -d '\r"'"'")"
[ -n "$TOK" ] || { echo "Нет ASR_SERVICE_TOKEN в $ENVF"; exit 1; }
HDR="$(mktemp)"; chmod 600 "$HDR"; printf 'Authorization: Bearer %s\n' "$TOK" > "$HDR"; unset TOK
trap 'rm -f "$HDR"' EXIT
[ -f "$OUT" ] || echo "phase,audio_sec,job_sec" > "$OUT"

one() {
  local i="$1" resp res code sec ad ps chars
  resp="$(mktemp)"
  res="$(curl -s -o "$resp" -w '%{time_total},%{http_code}' -m 3600 --resolve "$HOST:443:127.0.0.1" \
        -H @"$HDR" -F track=psychologist -F "audio=@$AUDIO" "https://$HOST/transcribe_track" || echo ",000")"
  code="${res##*,}"; sec="${res%%,*}"
  if [ "$code" = 200 ]; then
    read -r ad ps chars < <(python3 -c 'import json,sys
d=json.load(open(sys.argv[1])); print(d.get("duration_seconds",""), d.get("processing_seconds",""), len(d.get("text","")))' "$resp")
    echo "$PHASE,$ad,$sec" >> "$OUT"
    python3 -c 'import sys
ad,sec,ps,ch=float(sys.argv[2]),float(sys.argv[3]),sys.argv[4],sys.argv[5]
print("[%s #%s] аудио %.0f с, запрос %.1f с, RTF(запрос/аудио)=%.3f, processing_seconds=%s, символов=%s"%(sys.argv[1],sys.argv[6],ad,sec,sec/ad,ps,ch))' "$PHASE" "$ad" "$sec" "$sec" "$ps" "$chars" "$i" 2>/dev/null \
    || echo "[$PHASE #$i] ok: аудио ${ad}s, запрос ${sec}s"
  else
    echo "[$PHASE #$i] ОШИБКА HTTP $code ($(head -c 200 "$resp"))"
  fi
  rm -f "$resp"
}

echo "ASR bench: phase=$PHASE count=$COUNT parallel=$PAR file=$(basename "$AUDIO") ($(du -h "$AUDIO" | cut -f1))"
i=0
while [ "$i" -lt "$COUNT" ]; do
  pids=()
  for _ in $(seq 1 "$PAR"); do
    [ "$i" -lt "$COUNT" ] || break
    i=$((i+1)); one "$i" & pids+=($!)
  done
  wait "${pids[@]}"
done
echo "готово; результаты в $OUT"
