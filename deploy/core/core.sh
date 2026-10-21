#!/usr/bin/env bash
# Управление ядром ТОЛК (Caddy + сайт). Запуск НА core из ~/core:
#   ./core.sh init | build | up | restart-web | status | logs | rollback | stop | reload-caddy
# Секреты не печатает.
set -euo pipefail
cd "$(dirname "$0")"
DC="sudo -E docker compose -f docker-compose.yml"
getv() { grep -E "^$1=" .env.core | head -1 | cut -d= -f2- | tr -d '\r"' || true; }
setv() { if grep -q "^$1=" .env.core; then sed -i "s|^$1=.*|$1=$2|" .env.core; else echo "$1=$2" >> .env.core; fi; }

case "${1:-}" in
  init)
    [ -f .env.core ] || { umask 077; cp env.core.example .env.core; chmod 600 .env.core; }
    [ -n "$(getv CRON_SECRET)" ] || setv CRON_SECRET "$(openssl rand -hex 32)"
    [ -n "$(getv RECORDING_WEBHOOK_SECRET)" ] || setv RECORDING_WEBHOOK_SECRET "$(openssl rand -hex 32)"
    echo "OK: ~/core/.env.core готов (секреты сгенерированы, не выведены). Дальше: ключи Supabase и токен ASR (см. README), затем ./core.sh build"
    exit 0 ;;
esac

[ -f .env.core ] || { echo "Нет .env.core: сначала ./core.sh init" >&2; exit 1; }
[ -d ../tolk-src ] || { echo "Нет ../tolk-src (распакуйте архив исходников, см. README)" >&2; exit 1; }
for k in APP_DOMAIN DB_DOMAIN MEET_DOMAIN NEXT_PUBLIC_APP_URL NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_JITSI_DOMAIN; do
  v="$(getv $k)"; [ -n "$v" ] || { echo "В .env.core не задан $k" >&2; exit 1; }; export "$k=$v"
done
for k in SUPABASE_SERVICE_ROLE_KEY ASR_SERVICE_TOKEN CRON_SECRET; do
  [ -n "$(getv $k)" ] || { echo "В .env.core не заполнен $k" >&2; exit 1; }
done
[ -n "$(getv YANDEX_GPT_API_KEY)" ] || echo "ВНИМАНИЕ: YANDEX_GPT_API_KEY пуст — функции ИИ работать не будут (для тестов это нормально)." >&2
for k in CADDYFILE STAGE_DOMAIN; do v="$(getv $k)"; [ -z "$v" ] || export "$k=$v"; done
export GIT_COMMIT="$(tr -d "\r\n" < ../tolk-src/.git_commit 2>/dev/null || echo unknown)"

case "${1:-}" in
  build)
    sudo docker image inspect tolk-web:current >/dev/null 2>&1 && sudo docker tag tolk-web:current tolk-web:previous && echo "предыдущий образ: tolk-web:previous"
    nice -n 10 $DC build web
    sudo docker tag tolk-web:current "tolk-web:$(date +%Y%m%d-%H%M%S)" ;;
  up)
    $DC up -d web caddy; sleep 8; $0 status ;;
  restart-web)
    $DC up -d --force-recreate web; sleep 15; $0 status ;;
  status)
    $DC ps
    for c in web caddy; do id="$($DC ps -q $c 2>/dev/null || true)"; [ -n "$id" ] || continue
      sudo docker inspect -f "$c: state={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}} restarts={{.RestartCount}} oom={{.State.OOMKilled}}" "$id"; done
    echo "--- /api/health через Caddy (локально)"; curl -s -m 8 --resolve "$APP_DOMAIN:443:127.0.0.1" "https://$APP_DOMAIN/api/health" || echo "нет ответа (DNS и сертификат ещё не готовы?)"; echo ;;
  logs) $DC logs --tail 100 -f web caddy ;;
  rollback)
    sudo docker image inspect tolk-web:previous >/dev/null 2>&1 || { echo "Нет tolk-web:previous" >&2; exit 1; }
    sudo docker tag tolk-web:previous tolk-web:current; $DC up -d --no-deps --force-recreate web; sleep 5; $0 status ;;
  stop) $DC stop web caddy ;;
  reload-caddy) sudo docker exec "$($DC ps -q caddy)" caddy reload --config /etc/caddy/Caddyfile ;;
  *) echo "Использование: $0 init|build|up|status|logs|rollback|stop|reload-caddy" >&2; exit 1 ;;
esac
