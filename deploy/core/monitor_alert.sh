#!/usr/bin/env bash
# Проверки здоровья + оповещение (только при смене состояния OK<->FAIL, без спама).
# Режимы:
#   ./monitor_alert.sh            НА core: сайт, Supabase, ASR, диск, контейнеры, свежесть бэкапа, очередь транскрипции
#   ./monitor_alert.sh external https://tolkplace.ru/api/health   НА другой ВМ (например ASR): внешний взгляд на сайт
# Cron (каждые 5 минут):  */5 * * * * /home/ubuntu/core/monitor_alert.sh >> /var/log/tolk-monitor.log 2>&1
# Оповещение: файл ~/core/.alert.env (chmod 600) с TG_BOT_TOKEN и TG_CHAT_ID (Telegram) и/или ALERT_WEBHOOK_URL (POST JSON {"text": ...}).
# Доступность Telegram из РФ проверьте заранее (`./monitor_alert.sh test`); без канала проблемы только пишутся в лог.
set -uo pipefail
cd "$(dirname "$0")"
STATE="${STATE_FILE:-/tmp/tolk-monitor.state}"
[ -f .alert.env ] && { set -a; . ./.alert.env; set +a; }
getv() { grep -E "^$1=" .env.core 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r"'; }
HOST="$(hostname)"

notify() {   # notify "текст"
  local text="$1" sent=0
  if [ -n "${TG_BOT_TOKEN:-}" ] && [ -n "${TG_CHAT_ID:-}" ]; then
    curl -s -m 15 -o /dev/null -w '' "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" --data-urlencode "chat_id=${TG_CHAT_ID}" --data-urlencode "text=${text}" && sent=1
  fi
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -s -m 15 -o /dev/null -H 'Content-Type: application/json' -d "$(python3 -c 'import json,sys;print(json.dumps({"text":sys.argv[1]}))' "$text")" "$ALERT_WEBHOOK_URL" && sent=1
  fi
  [ "$sent" = 1 ] || echo "$(date -u +%FT%TZ) (нет канала оповещения) $text"
}

if [ "${1:-}" = test ]; then notify "ТОЛК monitor: тест оповещения с $HOST"; echo "отправлено (проверьте чат)"; exit 0; fi

fails=()
chk() { # chk "имя" команда...  (команда должна вернуть 0 при норме)
  local name="$1"; shift
  if ! "$@" >/dev/null 2>&1; then fails+=("$name"); fi
}

if [ "${1:-}" = external ]; then
  URL="${2:?usage: monitor_alert.sh external https://tolkplace.ru/api/health}"
  chk "сайт (внешняя проверка) $URL" curl -fsS -m 10 "$URL"
else
  APP="$(getv APP_DOMAIN)"; ASR="$(getv ASR_SERVICE_URL)"
  chk "сайт $APP /api/health" curl -fsS -m 8 --resolve "$APP:443:127.0.0.1" "https://$APP/api/health"
  if [ -f "$HOME/supabase/.env" ]; then
    ANON="$(grep -E '^ANON_KEY=' "$HOME/supabase/.env" | cut -d= -f2- | tr -d '"')"
    chk "Supabase auth health" curl -fsS -m 8 -H "apikey: $ANON" http://172.17.0.1:8000/auth/v1/health
  fi
  [ -n "$ASR" ] && chk "ASR $ASR/healthz" curl -fsS -m 8 "$ASR/healthz"
  use=$(df -P / | awk 'NR==2{gsub("%","",$5);print $5}'); [ "$use" -lt 85 ] || fails+=("диск / занят на ${use}%")
  bad="$(sudo docker ps --format '{{.Names}} {{.Status}}' | grep -Ei 'unhealthy|restarting' | awk '{print $1}' | tr '\n' ' ')"
  [ -z "$bad" ] || fails+=("контейнеры не в норме: $bad")
  BK="${BACKUP_DIR:-/var/backups/tolk}"
  if [ -d "$BK" ] && ls "$BK"/db_*.dump >/dev/null 2>&1; then
    newest=$(find "$BK" -name 'db_*.dump' -mmin -1560 | head -1); [ -n "$newest" ] || fails+=("нет свежего бэкапа БД (старше 26 ч)")
  fi
  # зависшие задачи транскрипции: pending/processing старше 30 минут
  if [ -f "$HOME/supabase/.env" ]; then
    PW="$(grep -E '^POSTGRES_PASSWORD=' "$HOME/supabase/.env" | cut -d= -f2- | tr -d '"')"
    stuck="$(sudo docker exec -e PGPASSWORD="$PW" supabase-db psql -h localhost -U supabase_admin -d postgres -At -c "select count(*) from public.recording_jobs where status in ('pending','processing') and created_at < now() - interval '30 minutes'" 2>/dev/null || echo 0)"
    [ "${stuck:-0}" = 0 ] || fails+=("очередь транскрипции: зависло задач $stuck (воркер jobs_cron.sh работает?)")
  fi
fi

if [ "${#fails[@]}" = 0 ]; then now=OK; msg="OK"; else now=FAIL; msg="$(printf '%s; ' "${fails[@]}")"; fi
prev="$(cat "$STATE" 2>/dev/null || echo OK)"
echo "$(date -u +%FT%TZ) $now $msg"
if [ "$now" != "$prev" ]; then
  if [ "$now" = FAIL ]; then notify "ТОЛК ($HOST): ПРОБЛЕМА: $msg"; else notify "ТОЛК ($HOST): восстановилось, всё в норме"; fi
  echo "$now" > "$STATE"
fi
