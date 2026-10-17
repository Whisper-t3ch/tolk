#!/usr/bin/env bash
# Проверка связи core -> ASR и токена (токен не печатается).
# Запуск на core: ./check_asr.sh
set -u
cd "$(dirname "$0")"
ENVF=.env.core
URL="$(grep -E '^ASR_SERVICE_URL=' "$ENVF" | head -1 | cut -d= -f2- | tr -d '\r"'"'")"
TOK="$(grep -E '^ASR_SERVICE_TOKEN=' "$ENVF" | head -1 | cut -d= -f2- | tr -d '\r"'"'")"
[ -n "$URL" ] || { echo "FAIL: нет ASR_SERVICE_URL в $ENVF"; exit 1; }
[ -n "$TOK" ] || { echo "FAIL: нет ASR_SERVICE_TOKEN в $ENVF"; exit 1; }
echo "ASR: $URL"
h="$(curl -s -m 8 -o /dev/null -w '%{http_code}' "$URL/healthz")"
echo "healthz: $h (ждём 200)"
HDR="$(mktemp)"; chmod 600 "$HDR"; printf 'Authorization: Bearer %s\n' "$TOK" > "$HDR"; unset TOK
a="$(curl -s -m 8 -o /dev/null -w '%{http_code}' -X POST -H @"$HDR" "$URL/transcribe_track")"
b="$(curl -s -m 8 -o /dev/null -w '%{http_code}' -X POST -H 'Authorization: Bearer wrong-token-0000000000' "$URL/transcribe_track")"
rm -f "$HDR"
echo "с токеном из .env.core: $a (422 = токен принят, 401/403 = токен не тот)"
echo "с неверным токеном:     $b (ждём 401/403)"
if [ "$h" = "200" ] && [ "$a" = "422" ]; then echo "OK: связь и токен в порядке"; else echo "FAIL: см. коды выше"; exit 1; fi
