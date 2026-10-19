#!/usr/bin/env bash
# Приём сообщений платформенного Telegram-бота через long polling (вебхук недоступен:
# Telegram не достучится до домена). Один вызов держится ~50 секунд, cron — раз в минуту.
# Установка (НА core, пользовательский crontab):
#   * * * * * /home/ubuntu/core/telegram_poll_cron.sh >> /home/ubuntu/tolk-tgpoll.log 2>&1
# Секрет берётся из .env.core, не печатается.
set -euo pipefail
cd "$(dirname "$0")"
exec 9>/tmp/tolk-tgpoll.lock; flock -n 9 || exit 0
getv() { grep -E "^$1=" .env.core | tail -1 | cut -d= -f2- | tr -d '\r"'; }
SECRET="$(getv CRON_SECRET)"; DOMAIN="$(getv APP_DOMAIN)"
[ -n "$SECRET" ] && [ -n "$DOMAIN" ] || { echo "$(date -u +%FT%TZ) нет CRON_SECRET/APP_DOMAIN" >&2; exit 1; }
out="$(curl -s -m 75 --resolve "$DOMAIN:443:127.0.0.1" -H "Authorization: Bearer $SECRET" "https://$DOMAIN/api/jobs/telegram-poll" || echo '{"error":"curl"}')"
case "$out" in
  *'"processed":0'*'"ok":true'*|*'"ok":true,"processed":0'*) : ;;   # тишина, если сообщений не было
  *) echo "$(date -u +%FT%TZ) tgpoll: ${out:0:200}" ;;
esac
