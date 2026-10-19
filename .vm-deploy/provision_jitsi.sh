#!/usr/bin/env bash
# ТОЛК: разворачивание self-hosted Jitsi на tolk-jitsi (Ubuntu 22.04).
# Запуск НА ВМ:  bash provision_jitsi.sh <e-mail для Let's Encrypt>
# Идемпотентен: повторный запуск не ломает уже созданный .env и пароли.
# Ничего секретного не печатает: пароли внутренних сервисов создаёт gen-passwords.sh и остаются в ~/jitsi/.env.
set -euo pipefail

EMAIL="${1:?usage: bash provision_jitsi.sh <email>}"
DOMAIN="meet.tolkplace.ru"
PUBLIC_IP="89.169.155.239"
DIR="$HOME/jitsi"
CFG="$HOME/.jitsi-meet-cfg"

log() { printf '\n=== %s ===\n' "$*"; }

log "1/8 Пакеты и Docker"
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y
sudo apt-get install -y git bc curl python3 tmux openssl ca-certificates dnsutils
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER" || true
D="sudo docker"   # группа docker применится только после перелогина, поэтому везде sudo

log "2/8 DNS должен смотреть на эту ВМ"
RESOLVED="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
echo "$DOMAIN -> ${RESOLVED:-не резолвится}"
if [ "$RESOLVED" != "$PUBLIC_IP" ]; then
  echo "ОШИБКА: $DOMAIN должен указывать на $PUBLIC_IP, иначе Let's Encrypt не выдаст сертификат." >&2
  exit 1
fi

log "3/8 docker-jitsi-meet и закреплённый stable-тег"
if [ ! -d "$DIR/.git" ]; then
  git clone https://github.com/jitsi/docker-jitsi-meet.git "$DIR"
fi
cd "$DIR"
git fetch --tags --quiet
TAG="$(git tag -l 'stable-*' | sort -V | tail -1)"
[ -n "$TAG" ] || { echo "Не найден stable-тег" >&2; exit 1; }
git checkout --quiet "$TAG"
echo "Закреплён тег: $TAG"

log "4/8 .env"
FIRST_RUN=0
if [ ! -f .env ]; then
  cp env.example .env
  ./gen-passwords.sh
  FIRST_RUN=1
fi

# setvar KEY VALUE: заменяет закомментированную или активную строку, иначе дописывает в конец
setvar() {
  local key="$1" val="$2"
  if grep -qE "^[#[:space:]]*${key}=" .env; then
    sed -i -E "s|^[#[:space:]]*${key}=.*|${key}=${val}|" .env
  else
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
}
setvar CONFIG "$CFG"
setvar PUBLIC_URL "https://${DOMAIN}"
setvar JITSI_IMAGE_VERSION "$TAG"
setvar HTTP_PORT 80
setvar HTTPS_PORT 443
setvar TZ UTC
# XMPP-домены = публичный домен (клиент ТОЛК строит hosts/muc/focus от NEXT_PUBLIC_JITSI_DOMAIN)
setvar XMPP_DOMAIN "$DOMAIN"
setvar XMPP_AUTH_DOMAIN "auth.${DOMAIN}"
setvar XMPP_GUEST_DOMAIN "guest.${DOMAIN}"
setvar XMPP_MUC_DOMAIN "conference.${DOMAIN}"
setvar ENABLE_AUTH 0
setvar ENABLE_GUESTS 0
setvar ENABLE_LETSENCRYPT 1
setvar LETSENCRYPT_DOMAIN "$DOMAIN"
setvar LETSENCRYPT_EMAIL "$EMAIL"
setvar LETSENCRYPT_ACME_SERVER letsencrypt
setvar JVB_ADVERTISE_IPS "$PUBLIC_IP"
setvar ENABLE_P2P true
setvar JVB_ENABLE_APIS "rest,colibri"
chmod 600 .env
[ "$FIRST_RUN" = 1 ] && echo ".env создан, пароли сгенерированы" || echo ".env уже был, значения обновлены, пароли сохранены"

log "5/8 Каталоги конфигурации и override для JVB-статистики (только 127.0.0.1)"
mkdir -p "$CFG"/{web,transcripts,prosody/config,prosody/prosody-plugins-custom,jicofo,jvb,jigasi,jibri}
cat > docker-compose.override.yml <<'YAML'
services:
  jvb:
    ports:
      - "127.0.0.1:8080:8080"
YAML

log "6/8 Запуск"
$D compose up -d
$D compose ps

log "7/8 Ожидание HTTPS (сертификат Let's Encrypt выпускается при первом старте, до ~3 мин)"
OK=0
for i in $(seq 1 36); do
  CODE="$(curl -s -o /dev/null -m 8 -w '%{http_code}' "https://${DOMAIN}/" || true)"
  if [ "$CODE" = "200" ]; then OK=1; break; fi
  sleep 5
done
[ "$OK" = 1 ] && echo "HTTPS отвечает 200" || echo "ВНИМАНИЕ: HTTPS пока не отвечает 200 (последний код: ${CODE:-нет}); смотрите логи ниже"

log "8/8 Монитор нагрузки в tmux (load_log.csv раз в 5 с)"
if [ -f "$HOME/vm_load_monitor.sh" ]; then
  tmux kill-session -t monitor 2>/dev/null || true
  tmux new-session -d -s monitor "cd $HOME && sudo bash $HOME/vm_load_monitor.sh 5"
  echo "tmux-сессия monitor запущена"
else
  echo "vm_load_monitor.sh не найден в $HOME, монитор не запущен (скопируйте файл и запустите вручную)"
fi

log "ПРОВЕРКИ"
echo "--- контейнеры"; $D compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
echo "--- сертификат"
echo | openssl s_client -connect "${DOMAIN}:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -issuer -dates || true
echo "--- config.js (домены и p2p)"
curl -s -m 10 "https://${DOMAIN}/config.js" | grep -E "domain|muc|focus|p2p|anonymous" | head -20 || true
echo "--- prosody (VirtualHost и аутентификация)"
$D compose exec -T prosody grep -n -E "VirtualHost|authentication" /config/prosody.cfg.lua || true
echo "--- JVB stats (локально)"
curl -s -m 5 http://127.0.0.1:8080/colibri/stats | head -c 400 || true; echo
echo "--- ошибки в логах за 10 минут"
$D compose logs --since 10m 2>&1 | grep -i -E "error|warn" | head -20 || true
echo
echo "ГОТОВО. Тег Jitsi: $TAG"
