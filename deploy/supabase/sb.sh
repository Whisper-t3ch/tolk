#!/usr/bin/env bash
# Управление self-hosted Supabase для ТОЛК. Запускать на сервере, из каталога ~/supabase.
#   ./sb.sh init <PUBLIC_URL> <SITE_URL>    первичная настройка .env (ключи генерируются, на экран НЕ выводятся)
#   ./sb.sh up | status | logs [сервис] | stop | psql
#   ./sb.sh sync-frontend <путь к .env.frontend>   записать URL и ключи Supabase в .env.frontend (без вывода секретов)
#   ./sb.sh smoke [BASE_URL]                       проверочный тест (создаёт и удаляет тестового пользователя)
#   ./sb.sh signup closed|open                     закрыть/открыть публичную регистрацию (после смены нужен ./sb.sh up)
#   ./sb.sh adduser <email>                        создать подтверждённого пользователя (для закрытой беты); пароль показывается один раз
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
  signup)
    MODE="${2:?usage: ./sb.sh signup closed|open}"
    case "$MODE" in closed) V=true;; open) V=false;; *) echo "closed или open"; exit 1;; esac
    setenv .env DISABLE_SIGNUP "$V"
    echo "OK: DISABLE_SIGNUP=$V. Применить: ./sb.sh up"
    ;;
  adduser)
    EMAIL="${2:?usage: ./sb.sh adduser psycholog@example.com}"
    # shellcheck disable=SC1091
    set -a; . ./.env; set +a
    BASE="http://${API_GW_BIND:-172.17.0.1}:${API_GW_HTTP_PORT:-8000}"
    PASS="$(openssl rand -base64 18 | tr -d '/+=' | head -c 16)A9"
    body="$(python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2],"email_confirm":True}))' "$EMAIL" "$PASS")"
    code=$(curl -s -o /tmp/.adduser_resp -w '%{http_code}' -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
           -H "Content-Type: application/json" -d "$body" "$BASE/auth/v1/admin/users")
    if [ "$code" = 200 ] || [ "$code" = 201 ]; then
      echo "OK: $EMAIL создан. Временный пароль (покажется один раз, передайте безопасным способом): $PASS"
      echo "Пользователю: после первого входа сменить пароль в настройках. Строка в psychologists создаётся триггером."
    else
      echo "ОШИБКА HTTP $code: $(head -c 300 /tmp/.adduser_resp)"
    fi
    rm -f /tmp/.adduser_resp; unset PASS body
    ;;
  smoke)
    exec ./smoke_test.sh "${2:-}"
    ;;
  *)
    sed -n '2,8p' "$0"
    exit 1
    ;;
esac
