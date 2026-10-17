#!/usr/bin/env bash
# Переводит Jitsi с собственного HTTPS/Let's Encrypt на работу за общим Caddy ядра. Запуск НА core:
#   ./jitsi_behind_caddy.sh <домен Jitsi, напр. meet.tolkplace.ru>
# Сбрасывает КОНФИГ Jitsi (~/.jitsi-meet-cfg: серверные настройки, не данные клиентов) и пересоздаёт контейнеры. Нужен DNS-запись домена -> IP core.
set -euo pipefail
DOM="${1:?укажите домен Jitsi}"
IP="$(curl -fsS https://api.ipify.org)"
RES="$(getent hosts "$DOM" | awk '{print $1}' | head -1 || true)"
[ "$RES" = "$IP" ] || { echo "ОШИБКА: $DOM указывает на '${RES:-ничего}', а IP ядра $IP. Сначала A-запись." >&2; exit 1; }
cd ~/jitsi
setenv() { local k="$1" v="$2"
  if grep -q "^$k=" .env; then sed -i "s|^$k=.*|$k=$v|" .env
  elif grep -q "^#\s*$k=" .env; then sed -i "0,/^#\s*$k=.*/s||$k=$v|" .env
  else echo "$k=$v" >> .env; fi; }
sudo docker compose down
setenv PUBLIC_URL "https://$DOM"
setenv XMPP_DOMAIN "$DOM"; setenv XMPP_AUTH_DOMAIN "auth.$DOM"; setenv XMPP_GUEST_DOMAIN "guest.$DOM"; setenv XMPP_MUC_DOMAIN "conference.$DOM"
setenv LETSENCRYPT_DOMAIN "$DOM"
setenv ENABLE_LETSENCRYPT 0; setenv DISABLE_HTTPS 1; setenv ENABLE_HTTP_REDIRECT 0
setenv HTTP_PORT 8002; setenv HTTPS_PORT 8445
setenv JVB_ADVERTISE_IPS "$IP"
sudo rm -rf ~/.jitsi-meet-cfg
mkdir -p ~/.jitsi-meet-cfg/{web,transcripts,prosody/config,prosody/prosody-plugins-custom,jicofo,jvb,jigasi,jibri} ~/.jitsi-meet-cfg/storage/{web,prosody,jicofo,jvb}
sudo chown -R 1000:1000 ~/.jitsi-meet-cfg
sudo docker compose up -d
echo "Jitsi запущен за Caddy (HTTP на 127.0.0.1:8002 внутри хоста). Проверка после запуска Caddy: curl -s -o /dev/null -w '%{http_code}\n' https://$DOM/"
sleep 15; sudo docker compose ps --format 'table {{.Name}}\t{{.Status}}'
