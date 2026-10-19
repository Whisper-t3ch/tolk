#!/usr/bin/env bash
# ТОЛК: разворачивание ASR-сервиса (GigaAM на CPU + Caddy/TLS + Bearer) на tolk-asr (Ubuntu 22.04).
# Запуск НА ВМ из каталога, где лежит папка asr-service с готовым .env:
#     bash provision_asr.sh
# В ~/asr-service/.env уже должны быть ASR_DOMAIN и ASR_SERVICE_TOKEN (токен нигде не печатается).
set -euo pipefail

DIR="$HOME/asr-service"
DOMAIN_EXPECTED="asr.tolkplace.ru"
PUBLIC_IP="51.250.92.52"
log() { printf '\n=== %s ===\n' "$*"; }

[ -d "$DIR" ] || { echo "Нет каталога $DIR (сначала scp -r asr-service ubuntu@$PUBLIC_IP:~/)" >&2; exit 1; }
[ -f "$DIR/.env" ] || { echo "Нет $DIR/.env" >&2; exit 1; }

log "1/6 Пакеты и Docker"
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y
sudo apt-get install -y git curl python3 openssl ca-certificates dnsutils
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER" || true
D="sudo docker"

log "2/6 Проверка DNS и .env (значения токена не показываются)"
RESOLVED="$(getent hosts "$DOMAIN_EXPECTED" | awk '{print $1}' | head -1 || true)"
echo "$DOMAIN_EXPECTED -> ${RESOLVED:-не резолвится}"
[ "$RESOLVED" = "$PUBLIC_IP" ] || { echo "ОШИБКА: DNS $DOMAIN_EXPECTED должен указывать на $PUBLIC_IP" >&2; exit 1; }
cd "$DIR"
grep -q '^ASR_DOMAIN=.\+' .env || { echo "ASR_DOMAIN не задан в .env" >&2; exit 1; }
TOKEN_LEN="$(grep '^ASR_SERVICE_TOKEN=' .env | cut -d= -f2- | tr -d '\r\n' | wc -c)"
echo "длина ASR_SERVICE_TOKEN: $TOKEN_LEN"
[ "$TOKEN_LEN" -ge 32 ] || { echo "ASR_SERVICE_TOKEN короче 32 символов" >&2; exit 1; }
chmod 600 .env
sed -i 's/\r$//' .env smoke_test.sh Caddyfile 2>/dev/null || true
chmod +x smoke_test.sh

log "3/6 Закрепление версии GigaAM (если в .env всё ещё main)"
CUR_REF="$(grep '^GIGAAM_REF=' .env | cut -d= -f2- | tr -d '\r\n' || true)"
if [ -z "$CUR_REF" ] || [ "$CUR_REF" = "main" ]; then
  REF="$(git ls-remote https://github.com/salute-developers/GigaAM HEAD | cut -f1)"
  [ -n "$REF" ] || { echo "Не удалось получить коммит GigaAM" >&2; exit 1; }
  if grep -q '^GIGAAM_REF=' .env; then sed -i "s|^GIGAAM_REF=.*|GIGAAM_REF=${REF}|" .env; else echo "GIGAAM_REF=${REF}" >> .env; fi
  echo "GIGAAM_REF закреплён: $REF"
else
  echo "GIGAAM_REF уже задан: $CUR_REF"
fi

log "4/6 Сборка и запуск (первая сборка 10-15 минут, затем загрузка весов модели)"
$D compose up -d --build 2>&1 | tail -25
$D compose ps

log "5/6 Ожидание загрузки модели и сертификата (до 25 минут)"
OK=0
for i in $(seq 1 150); do
  BODY="$(curl -s -m 8 "https://${DOMAIN_EXPECTED}/healthz" || true)"
  if echo "$BODY" | grep -q '"model_loaded": *true'; then OK=1; break; fi
  sleep 10
done
echo "healthz: ${BODY:-нет ответа}"
if [ "$OK" != 1 ]; then
  echo "ВНИМАНИЕ: модель не загрузилась за отведённое время. Логи asr:"
  $D compose logs --tail 60 asr 2>&1 || true
  echo "Логи caddy:"
  $D compose logs --tail 30 caddy 2>&1 || true
  exit 2
fi

log "6/6 Smoke-тест (4 проверки; токен берётся из .env и не печатается)"
TOKEN="$(grep '^ASR_SERVICE_TOKEN=' .env | cut -d= -f2- | tr -d '\r\n')"
./smoke_test.sh "https://${DOMAIN_EXPECTED}" "$TOKEN" || true
echo
echo "--- ресурсы"; $D stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
echo "--- ошибки в логах"; $D compose logs --since 30m 2>&1 | grep -i -E "error|traceback" | head -20 || true
echo
echo "ГОТОВО."
