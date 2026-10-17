#!/usr/bin/env bash
# Воркер очереди транскрипции: заменяет Vercel Cron. Один вызов API обрабатывает ровно одну задачу,
# поэтому скрипт вызывает его в цикле, пока есть задачи (максимум MAX за запуск).
# Установка (НА core, пользовательский crontab; включать только по решению владельца):
#   * * * * * /home/ubuntu/core/jobs_cron.sh >> /var/log/tolk-jobs.log 2>&1
# Секрет берётся из .env.core, не печатается.
set -euo pipefail
cd "$(dirname "$0")"
MAX="${MAX:-5}"
exec 9>/tmp/tolk-jobs.lock; flock -n 9 || exit 0      # не запускать параллельно
getv() { grep -E "^$1=" .env.core | head -1 | cut -d= -f2- | tr -d '\r"'; }
SECRET="$(getv CRON_SECRET)"; DOMAIN="$(getv APP_DOMAIN)"
[ -n "$SECRET" ] && [ -n "$DOMAIN" ] || { echo "$(date -u +%FT%TZ) нет CRON_SECRET/APP_DOMAIN" >&2; exit 1; }
for i in $(seq 1 "$MAX"); do
  out="$(curl -s -m 320 --resolve "$DOMAIN:443:127.0.0.1" -H "Authorization: Bearer $SECRET" "https://$DOMAIN/api/jobs/process" || echo '{"error":"curl"}')"
  case "$out" in
    *'"processed":true'*) echo "$(date -u +%FT%TZ) job: $out" ;;
    *'"processed":false'*) exit 0 ;;
    *) echo "$(date -u +%FT%TZ) ошибка: ${out:0:200}" >&2; exit 1 ;;
  esac
done
