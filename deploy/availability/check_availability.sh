#!/usr/bin/env bash
# Проверка доступности ТОЛК с Linux/ВМ. Запуск: bash check_availability.sh "yandex-vm"
NET="${1:-unknown}"; SB="gprmbaiacvchtovzpeqa.supabase.co"
echo "Сеть: $NET   Время: $(date -Is)"; echo "Внешний IP: $(curl -s -m 8 https://api.ipify.org || echo н/д)"
probe() { # имя хост путь
  echo "---- $1: $2$3"
  echo "DNS: $(getent hosts $2 | awk '{print $1}' | paste -sd, -)"
  for i in 1 2 3; do
    curl -s -o /dev/null -m 20 -w "  try$i: HTTP %{http_code}, connect %{time_connect}s, tls %{time_appconnect}s, ttfb %{time_starttransfer}s, total %{time_total}s\n" "https://$2$3" || echo "  try$i: ОШИБКА (curl код $?)"
  done
}
probe "Vercel prod" tolk-three.vercel.app /login
probe "tolkplace.ru" tolkplace.ru /login
probe "staging" stage.tolkplace.ru /api/health
probe "Jitsi" meet.tolkplace.ru /
probe "ASR healthz" asr.tolkplace.ru /healthz
probe "Supabase REST" $SB /rest/v1/
probe "Supabase Auth" $SB /auth/v1/health
probe "Supabase Storage" $SB /storage/v1/
echo "---- Supabase Storage: POST 2 МБ без ключа (ждём 400/401/403, не обрыв)"
head -c 2097152 /dev/urandom | curl -s -o /dev/null -m 40 -X POST -H "Content-Type: application/octet-stream" --data-binary @- -w "HTTP %{http_code}, total %{time_total}s\n" "https://$SB/storage/v1/object/session-recordings/_availability_probe" || echo "ОШИБКА (curl код $?)"
