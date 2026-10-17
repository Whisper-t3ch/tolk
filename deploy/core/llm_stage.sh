#!/usr/bin/env bash
# Подключает GigaChat (Сбер) к сайту на core. Запуск НА core из ~/core, ПОСЛЕ того как в ~/tolk-src лежит код с src/lib/llm:
#   ./llm_stage.sh [on|off|status] [модель_Pro] [модель_Lite]
#   on      скачать корневой сертификат Минцифры, спросить ключ (ввод скрытый), проверить его, записать в .env.core, перезапустить сайт
#   off     вернуть YandexGPT (LLM_PROVIDER убирается), перезапустить сайт
#   status  показать, что включено (значения секретов не печатаются)
# Ключ в чат и в историю shell не попадает (читается с терминала, в .env.core chmod 600).
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env.core ] || { echo "Нет .env.core (./core.sh init)" >&2; exit 1; }
getv() { grep -E "^$1=" .env.core | head -1 | cut -d= -f2- | tr -d '\r"' || true; }
setv() { if grep -q "^$1=" .env.core; then sed -i "s|^$1=.*|$1=$2|" .env.core; else echo "$1=$2" >> .env.core; fi; }
delv() { sed -i "/^$1=/d" .env.core; }
CA_DIR="$PWD/certs"; CA_FILE="$CA_DIR/ru-ca.pem"
CA_URL="https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt"

case "${1:-status}" in
  on)
    PRO="${2:-GigaChat-2-Pro}"; LITE="${3:-}"
    mkdir -p "$CA_DIR"
    echo "== 1/4 сертификат Минцифры"
    curl -fsS -m 30 "$CA_URL" -o "$CA_FILE"
    openssl x509 -in "$CA_FILE" -noout -subject -enddate -fingerprint -sha256
    echo "Сверьте имя и отпечаток с gosuslugi.ru/crt, если сомневаетесь в источнике."
    echo "== 2/4 проверка TLS до API Сбера"
    code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' --cacert "$CA_FILE" https://gigachat.devices.sberbank.ru/api/v1/models || true)
    echo "api/v1/models без ключа: HTTP $code (401 = TLS прошёл, нужен ключ)"
    [ "$code" = 401 ] || [ "$code" = 200 ] || { echo "TLS не прошёл: добавьте подчинённый сертификат (gosuslugi.ru/crt) в $CA_FILE" >&2; exit 1; }
    echo "== 3/4 ключ авторизации (ввод скрытый)"
    read -rsp "Authorization key: " KEY </dev/tty; echo
    [ -n "$KEY" ] || { echo "Пустой ключ" >&2; exit 1; }
    scope="$(getv LLM_OAUTH_SCOPE || true)"; scope="${scope:-GIGACHAT_API_PERS}"
    code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' --cacert "$CA_FILE" -X POST https://ngw.devices.sberbank.ru:9443/api/v2/oauth \
      -H "Authorization: Basic $KEY" -H "RqUID: $(cat /proc/sys/kernel/random/uuid)" -H "Content-Type: application/x-www-form-urlencoded" \
      -d "scope=$scope" || true)
    echo "OAuth: HTTP $code (200 = ключ принят)"
    [ "$code" = 200 ] || { unset KEY; echo "Ключ не принят, .env.core не менял." >&2; exit 1; }
    echo "== 4/4 запись в .env.core и перезапуск сайта"
    cp -p .env.core ".env.core.bak.$(date +%Y%m%d-%H%M%S)"
    setv LLM_PROVIDER openai_compat
    setv LLM_DIALECT gigachat
    setv LLM_AUTH gigachat_oauth
    setv LLM_OAUTH_SCOPE "$scope"
    setv LLM_API_KEY "$KEY"; unset KEY
    setv LLM_MODEL_PRO "$PRO"
    if [ -n "$LITE" ]; then setv LLM_MODEL_LITE "$LITE"; else delv LLM_MODEL_LITE; fi
    setv NODE_EXTRA_CA_CERTS /certs/ru-ca.pem
    chmod 600 .env.core
    ./core.sh restart-web
    echo "Готово: GigaChat включён (Pro=$PRO${LITE:+, Lite=$LITE}). Вернуть Яндекс: ./llm_stage.sh off"
    ;;
  off)
    cp -p .env.core ".env.core.bak.$(date +%Y%m%d-%H%M%S)"
    for k in LLM_PROVIDER LLM_DIALECT LLM_AUTH LLM_OAUTH_SCOPE LLM_API_KEY LLM_MODEL_PRO LLM_MODEL_LITE NODE_EXTRA_CA_CERTS; do delv "$k"; done
    ./core.sh restart-web
    echo "GigaChat выключен." ;;
  status)
    for k in LLM_PROVIDER LLM_DIALECT LLM_AUTH LLM_OAUTH_SCOPE LLM_MODEL_PRO LLM_MODEL_LITE NODE_EXTRA_CA_CERTS; do printf '%s=%s\n' "$k" "$(getv $k)"; done
    [ -n "$(getv LLM_API_KEY)" ] && echo "LLM_API_KEY=<задан>" || echo "LLM_API_KEY=<пусто>"
    [ -f "$CA_FILE" ] && echo "сертификат: есть" || echo "сертификат: нет" ;;
  *) echo "Использование: $0 on [Pro] [Lite] | off | status" >&2; exit 1 ;;
esac
