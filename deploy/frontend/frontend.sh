#!/usr/bin/env bash
# Управление фронтендом ТОЛК рядом с ASR. Запуск НА ВМ из ~/asr-service:
#   ./frontend.sh build | up | status | logs | rollback | stop | reload-caddy
# Секреты не печатает. ASR-контейнер не пересоздаёт (--no-deps).
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env.frontend ] || { echo "Нет .env.frontend (шаблон: env.frontend.example)" >&2; exit 1; }
[ -d ../tolk-src ] || { echo "Нет ../tolk-src (распакуйте архив исходников, см. README)" >&2; exit 1; }

getv() { grep -E "^$1=" .env.frontend | head -1 | cut -d= -f2- | tr -d '\r"' ; }
for k in FRONTEND_DOMAINS NEXT_PUBLIC_APP_URL NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_JITSI_DOMAIN; do
  v="$(getv $k)"; [ -n "$v" ] || { echo "В .env.frontend не задан $k" >&2; exit 1; }
  export "$k=$v"
done
export GIT_COMMIT="$(cat ../tolk-src/.git_commit 2>/dev/null || echo unknown)"
DC="sudo -E docker compose -f docker-compose.yml -f docker-compose.frontend.yml"

case "${1:-}" in
  build)
    echo "== preflight: next/font/google тянет шрифты при СБОРКЕ =="
    curl -s -o /dev/null -m 15 -w "fonts.googleapis.com: %{http_code}\n" "https://fonts.googleapis.com/css2?family=Inter&display=swap" | grep -q "200" \
      || { echo "fonts.googleapis.com недоступен с ВМ — сборка упадёт. См. README, раздел «Шрифты при сборке»." >&2; exit 1; }
    echo "== сборка (nice/ionice, чтобы не мешать ASR; 5–15 мин) =="
    sudo docker image inspect tolk-web:current >/dev/null 2>&1 && sudo docker tag tolk-web:current tolk-web:previous && echo "предыдущий образ сохранён как tolk-web:previous"
    nice -n 19 ionice -c3 $DC build web
    sudo docker tag tolk-web:current "tolk-web:$(date +%Y%m%d-%H%M%S)"
    ;;
  up)
    $DC up -d --no-deps web
    $DC up -d --no-deps caddy      # пересоздаёт только Caddy: asr.tolkplace.ru недоступен ~несколько секунд
    sleep 5; $0 status
    ;;
  status)
    $DC ps
    echo "--- health"; for c in web asr caddy; do
      id="$($DC ps -q $c 2>/dev/null || true)"; [ -n "$id" ] || continue
      sudo docker inspect -f "$c: state={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}} restarts={{.RestartCount}} oom={{.State.OOMKilled}}" "$id"
    done
    echo "--- внутренний healthcheck"; curl -s -m 5 --resolve "$(echo $FRONTEND_DOMAINS | awk '{print $1}'):443:127.0.0.1" "https://$(echo $FRONTEND_DOMAINS | awk '{print $1}')/api/health" || echo "нет ответа"; echo
    ;;
  logs) $DC logs --tail 100 -f web ;;
  rollback)
    sudo docker image inspect tolk-web:previous >/dev/null 2>&1 || { echo "Нет tolk-web:previous — откатываться некуда (останов: ./frontend.sh stop)" >&2; exit 1; }
    sudo docker tag tolk-web:previous tolk-web:current
    $DC up -d --no-deps --force-recreate web
    sleep 5; $0 status
    ;;
  stop)
    $DC stop web && echo "web остановлен. Caddy вернёт 502 для FRONTEND_DOMAINS; ASR не затронут."
    ;;
  reload-caddy)
    sudo docker exec "$($DC ps -q caddy)" caddy reload --config /etc/caddy/Caddyfile
    ;;
  *) echo "Использование: $0 build|up|status|logs|rollback|stop|reload-caddy" >&2; exit 1 ;;
esac
