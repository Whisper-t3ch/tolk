#!/usr/bin/env bash
# Переключение сайта между stage и боевым доменом. Запуск НА core из ~/core:
#   ./switch_domain.sh prod [tolkplace.ru]   боевой адрес (www и stage перенаправляются на него)
#   ./switch_domain.sh stage                 вернуть stage.tolkplace.ru (откат)
# Что делает: правит .env.core (бэкап рядом), SITE_URL/ADDITIONAL_REDIRECT_URLS Supabase Auth (~/supabase/.env),
# пересобирает образ (NEXT_PUBLIC_APP_URL вшивается при сборке), перезапускает сайт, Caddy и auth.
# ДО запуска боевого режима: A-записи tolkplace.ru и www уже указывают на этот сервер или переключаются прямо сейчас
# (Caddy выпустит сертификат, как только DNS начнёт отвечать). Секреты не печатаются.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env.core ] || { echo "Нет .env.core" >&2; exit 1; }
SB="$HOME/supabase/.env"; [ -f "$SB" ] || { echo "Нет $SB" >&2; exit 1; }
setv() { local f="$1" k="$2" v="$3"; if grep -q "^$k=" "$f"; then sed -i "s|^$k=.*|$k=$v|" "$f"; else echo "$k=$v" >> "$f"; fi; }
case "${1:-}" in
  prod)  APP="${2:-tolkplace.ru}"; CADDY="./Caddyfile.prod" ;;
  stage) APP="stage.tolkplace.ru";  CADDY="" ;;
  *) sed -n '2,6p' "$0"; exit 1 ;;
esac
URL="https://$APP"
cp -p .env.core ".env.core.bak.$(date +%Y%m%d-%H%M%S)"; cp -p "$SB" "$SB.bak.$(date +%Y%m%d-%H%M%S)"
setv .env.core APP_DOMAIN "$APP"
setv .env.core NEXT_PUBLIC_APP_URL "$URL"
setv .env.core CADDYFILE "$CADDY"
setv .env.core STAGE_DOMAIN "stage.tolkplace.ru"
setv "$SB" SITE_URL "$URL"
setv "$SB" ADDITIONAL_REDIRECT_URLS "$URL/**"
echo "== Supabase auth: применить новые SITE_URL/redirect"
( cd "$HOME/supabase" && ./sb.sh up >/dev/null )
echo "== Сборка образа с NEXT_PUBLIC_APP_URL=$URL (несколько минут; сайт пока работает на старом образе)"
./core.sh build
./core.sh up
./core.sh reload-caddy || true
echo "Готово: $URL. Проверка: ./core.sh status; curl -sI $URL | head -3"
echo "Откат: ./switch_domain.sh stage"
