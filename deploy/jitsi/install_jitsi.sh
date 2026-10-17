#!/usr/bin/env bash
# Установка self-hosted Jitsi (docker-jitsi-meet, закреплённый stable-тег) на ядро. Запуск НА core (Ubuntu 24.04, Docker уже стоит).
#   ./install_jitsi.sh <e-mail для Let's Encrypt> [домен]     домен по умолчанию: <ip-через-дефисы>.sslip.io (DNS не нужен)
# Переменные: P2P=true|false (по умолчанию true), JITSI_TAG=stable-NNNN (по умолчанию последний).
# Порты: 80/443 TCP и 10000 UDP должны быть свободны на хосте. Для боя нужен общий входной прокси (Caddy) — это отдельный шаг.
set -euo pipefail
EMAIL="${1:?укажите e-mail для LetsEncrypt}"
IP="$(curl -fsS https://api.ipify.org)"
DOMAIN="${2:-${IP//./-}.sslip.io}"
P2P="${P2P:-true}"
for p in 80 443; do ss -ltn "( sport = :$p )" | grep -q LISTEN && { echo "ОШИБКА: порт $p занят"; exit 1; }; done
cd ~
[ -d jitsi ] || git clone -q https://github.com/jitsi/docker-jitsi-meet.git jitsi
cd jitsi
git fetch -q --tags
TAG="${JITSI_TAG:-$(git ls-remote --tags --refs https://github.com/jitsi/docker-jitsi-meet 'stable-*' | sed 's#.*refs/tags/##' | sort -V | tail -1)}"
git checkout -q "$TAG"; echo "Тег: $TAG  Домен: $DOMAIN  IP: $IP  P2P: $P2P"
if [ ! -f .env ]; then cp env.example .env; ./gen-passwords.sh; fi
setenv() { local k="$1" v="$2"
  if grep -q "^$k=" .env; then sed -i "s|^$k=.*|$k=$v|" .env
  elif grep -q "^#\s*$k=" .env; then sed -i "0,/^#\s*$k=.*/s||$k=$v|" .env
  else echo "$k=$v" >> .env; fi; }
setenv PUBLIC_URL "https://$DOMAIN"; setenv JITSI_IMAGE_VERSION "$TAG"
setenv CONFIG "$HOME/.jitsi-meet-cfg"; setenv HTTP_PORT 80; setenv HTTPS_PORT 443; setenv TZ UTC
setenv XMPP_DOMAIN "$DOMAIN"; setenv XMPP_AUTH_DOMAIN "auth.$DOMAIN"; setenv XMPP_GUEST_DOMAIN "guest.$DOMAIN"; setenv XMPP_MUC_DOMAIN "conference.$DOMAIN"
setenv ENABLE_AUTH 0; setenv ENABLE_GUESTS 0
setenv ENABLE_LETSENCRYPT 1; setenv LETSENCRYPT_DOMAIN "$DOMAIN"; setenv LETSENCRYPT_EMAIL "$EMAIL"; setenv LETSENCRYPT_ACME_SERVER letsencrypt
setenv JVB_ADVERTISE_IPS "$IP"; setenv ENABLE_P2P "$P2P"; setenv JVB_ENABLE_APIS "rest,colibri"
chmod 600 .env
mkdir -p ~/.jitsi-meet-cfg/{web,transcripts,prosody/config,prosody/prosody-plugins-custom,jicofo,jvb,jigasi,jibri}
mkdir -p ~/.jitsi-meet-cfg/storage/{web,prosody,jicofo,jvb}
sudo chown -R 1000:1000 ~/.jitsi-meet-cfg
cat > docker-compose.override.yml <<'YML'
services:
  jvb:
    ports:
      - "127.0.0.1:8080:8080"
YML
if sudo ufw status | grep -q "Status: active"; then
  sudo ufw allow 80/tcp >/dev/null; sudo ufw allow 443/tcp >/dev/null; sudo ufw allow 10000/udp >/dev/null; echo "ufw: 80, 443, 10000/udp открыты"
fi
DC=docker; docker ps >/dev/null 2>&1 || DC="sudo docker"
$DC compose up -d
echo "ждём сертификат и запуск (до 90 с)..."
for i in $(seq 1 18); do sleep 5; code="$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/" || true)"; [ "$code" = 200 ] && break; done
echo "HTTPS $DOMAIN: $code"
$DC compose ps --format 'table {{.Name}}\t{{.Status}}'
curl -s "https://$DOMAIN/config.js" | grep -E "p2p|enabled: |hosts|domain:|muc:" | head -8 || true
echo "$DOMAIN" > ~/jitsi/.domain
