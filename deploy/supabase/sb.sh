#!/usr/bin/env bash
# Управление self-hosted Supabase для ТОЛК. Запускать на сервере, из каталога ~/supabase.
#   ./sb.sh init <PUBLIC_URL> <SITE_URL>    первичная настройка .env (ключи генерируются, на экран НЕ выводятся)
#   ./sb.sh up | status | logs [сервис] | stop | psql
#   ./sb.sh sync-frontend <путь к .env.frontend>   записать URL и ключи Supabase в .env.frontend (без вывода секретов)
#   ./sb.sh smoke [BASE_URL]                       проверочный тест (создаёт и удаляет тестового пользователя)
set -euo pipefail
cd "$(dirname "$0")"

DC=(sudo docker compose -f docker-compose.yml -f docker-compose.beta.yml)

setenv() { # setenv FILE KEY VALUE (значение не печатается)
  local f="$1" k="$2" v="$3"
  if grep -q "^${k}=" "$f"; then
    sed -i "s|^${k}=.*|${k}=${v//|/\\|}|" "$f"
  else
    printf '%s=%s\n' "$k" "$v" >> "$f"
  fi
}

case "${1:-}" in
  init)
    PUBLIC_URL="${2:?usage: ./sb.sh init https://db.tolkplace.ru https://stage.tolkplace.ru}"
    SITE_URL="${3:?usage: ./sb.sh init https://db.tolkplace.ru https://stage.tolkplace.ru}"
    if [ -f .env ]; then echo ".env уже существует — не перезаписываю (удалите вручную, если нужно начать заново)."; exit 1; fi
    umask 077
    cp .env.example .env
    sh utils/generate-keys.sh --update-env >/dev/null
    rm -f .env.old
    setenv .env SUPABASE_PUBLIC_URL "${PUBLIC_URL%/}"
    setenv .env API_EXTERNAL_URL "${PUBLIC_URL%/}/auth/v1"
    setenv .env SITE_URL "${SITE_URL%/}"
    setenv .env ADDITIONAL_REDIRECT_URLS "${SITE_URL%/}/**"
    # Для staging подтверждение почты выключено (нет SMTP). Для беты — решить отдельно (нужен SMTP).
    setenv .env ENABLE_EMAIL_AUTOCONFIRM "${AUTOCONFIRM:-true}"
    setenv .env ENABLE_PHONE_SIGNUP false
    setenv .env ENABLE_PHONE_AUTOCONFIRM false
    setenv .env ENABLE_ANONYMOUS_USERS false
    chmod 600 .env
    echo "OK: .env создан (chmod 600). Секреты не выведены. Дальше: ./sb.sh up"
    ;;
  up)
    "${DC[@]}" up -d
    "${DC[@]}" ps
    ;;
  status)
    "${DC[@]}" ps
    sudo docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' | grep -E 'NAME|supabase' || true
    ;;
  logs)
    shift || true
    "${DC[@]}" logs --tail=100 -f "$@"
    ;;
  stop)
    "${DC[@]}" stop      # НЕ down -v: данные сохраняются
    ;;
  psql)
    sudo docker exec -it supabase-db psql -U supabase_admin -d postgres
    ;;
  sync-frontend)
    TARGET="${2:?usage: ./sb.sh sync-frontend ~/asr-service/.env.frontend}"
    [ -f "$TARGET" ] || { echo "Нет файла $TARGET"; exit 1; }
    # shellcheck disable=SC1091
    set -a; . ./.env; set +a
    setenv "$TARGET" NEXT_PUBLIC_SUPABASE_URL "$SUPABASE_PUBLIC_URL"
    setenv "$TARGET" NEXT_PUBLIC_SUPABASE_ANON_KEY "$ANON_KEY"
    setenv "$TARGET" SUPABASE_SERVICE_ROLE_KEY "$SERVICE_ROLE_KEY"
    echo "OK: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY записаны в $TARGET"
    echo "Дальше пересобрать web: ./frontend.sh build && ./frontend.sh up"
    ;;
  smoke)
    exec ./smoke_test.sh "${2:-}"
    ;;
  *)
    sed -n '2,8p' "$0"
    exit 1
    ;;
esac
