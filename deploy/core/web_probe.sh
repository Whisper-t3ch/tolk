#!/usr/bin/env bash
# Быстрая проверка сайта на core: TTFB и доля ошибок через Caddy (локально, TLS).
# Запуск на core: ./web_probe.sh [запросов=300] [параллельно=10]
set -u
cd "$(dirname "$0")"
N="${1:-300}"; P="${2:-10}"
APP="$(grep -E '^APP_DOMAIN=' .env.core | head -1 | cut -d= -f2- | tr -d '\r"'"'")"
[ -n "$APP" ] || { echo "нет APP_DOMAIN в .env.core"; exit 1; }
probe() { # путь
  local path="$1" out; out="$(mktemp)"
  seq "$N" | xargs -P "$P" -I{} curl -s -o /dev/null -m 20 -w '%{http_code} %{time_starttransfer}\n' \
    --resolve "$APP:443:127.0.0.1" "https://$APP$path" > "$out"
  local n err p50 p95 mx
  n="$(wc -l < "$out")"
  err="$(awk '$1 >= 400 || $1 == 0 { c++ } END { print c+0 }' "$out")"
  awk '{ print $2 }' "$out" | sort -n > "$out.t"
  p50="$(awk -v n="$n" 'NR==int(n*0.5)+1 { print; exit }' "$out.t")"
  p95="$(awk -v n="$n" 'NR==int(n*0.95)+1 { print; exit }' "$out.t")"
  mx="$(tail -1 "$out.t")"
  printf '%-14s запросов=%s ошибок=%s TTFB p50=%s с p95=%s с max=%s с\n' "$path" "$n" "$err" "$p50" "$p95" "$mx"
  rm -f "$out.t"
  rm -f "$out"
}
echo "Сайт: https://$APP, $N запросов, $P параллельно"
probe /api/health
probe /
probe /login
echo "Критерий: p95 < 1.5 с, ошибок < 1%"
