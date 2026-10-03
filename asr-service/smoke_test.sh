#!/usr/bin/env bash
# Проверка ASR-сервиса снаружи: ./smoke_test.sh https://asr.tolkplace.ru <ASR_SERVICE_TOKEN>
# Не требует ffmpeg на хосте: тестовый wav (5 с тона) делает python3.
set -u
URL="${1:?usage: smoke_test.sh <base_url> <token>}"
TOKEN="${2:?usage: smoke_test.sh <base_url> <token>}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

python3 - "$TMP/tone.wav" <<'EOF'
import math, struct, sys, wave
w = wave.open(sys.argv[1], "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
w.writeframes(b"".join(struct.pack("<h", int(9000 * math.sin(2 * math.pi * 220 * i / 16000))) for i in range(16000 * 5)))
w.close()
EOF

fail=0
check() { # имя ожидаемый_код фактический_код
  if [ "$2" = "$3" ]; then echo "OK   $1 (HTTP $3)"; else echo "FAIL $1: ожидали $2, получили $3"; fail=1; fi
}

check "healthz открыт" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$URL/healthz")"
echo "     $(curl -s "$URL/healthz")"
check "без токена -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -F track=client -F audio=@$TMP/tone.wav "$URL/transcribe_track")"
check "неверный токен -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer wrong' -F track=client -F audio=@$TMP/tone.wav "$URL/transcribe_track")"

code="$(curl -s -m 600 -o "$TMP/out.json" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" -F track=client -F audio=@$TMP/tone.wav "$URL/transcribe_track")"
check "с токеном -> 200" 200 "$code"
echo "     $(head -c 400 "$TMP/out.json")"
exit $fail
