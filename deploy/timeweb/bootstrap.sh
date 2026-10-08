#!/usr/bin/env bash
# Первичная настройка нового сервера Ubuntu 22.04/24.04 (Таймвеб): Docker, файрвол, fail2ban, автообновления безопасности.
#   sudo ./bootstrap.sh core <MY_IP>              ядро: сайт + Supabase + Jitsi
#   sudo ./bootstrap.sh asr  <MY_IP> <CORE_IP>    ASR-сервер: доступ к сервису распознавания только с ядра
# MY_IP - ваш домашний IP (SSH только с него). DRY=1 - показать команды, ничего не меняя.
# Идемпотентно: можно запускать повторно. Пароль SSH НЕ отключается (чтобы не потерять доступ): после проверки входа по ключу
# отключите вручную: PasswordAuthentication no в /etc/ssh/sshd_config.d/ и systemctl reload ssh.
# ВАЖНО: порты, опубликованные Docker, обходят ufw. Поэтому Supabase шлюз привязан к 172.17.0.1 (docker-compose.beta.yml),
# а наружу публикуются только Caddy (80/443) и Jitsi (UDP 10000). Также проверьте файрвол в панели Таймвеба.
set -euo pipefail
ROLE="${1:?core|asr}"; MY_IP="${2:?ваш IP для SSH}"; CORE_IP="${3:-}"
[ "$ROLE" = asr ] && [ -z "$CORE_IP" ] && { echo "Для asr нужен IP ядра третьим аргументом"; exit 1; }
[ "$(id -u)" = 0 ] || [ "${DRY:-}" = 1 ] || { echo "Запустите через sudo"; exit 1; }
run() { if [ "${DRY:-}" = 1 ]; then echo "+ $*"; else eval "$@"; fi; }

echo "== Пакеты"
run "export DEBIAN_FRONTEND=noninteractive; apt-get update -y"
run "export DEBIAN_FRONTEND=noninteractive; apt-get install -y ca-certificates curl ufw fail2ban unattended-upgrades docker.io docker-compose-v2 python3 openssl sysstat"
run "systemctl enable --now docker fail2ban"
run "dpkg-reconfigure -f noninteractive unattended-upgrades || true"
run "timedatectl set-timezone Europe/Moscow"

echo "== Файрвол (ufw)"
run "ufw --force reset"
run "ufw default deny incoming; ufw default allow outgoing"
run "ufw allow from $MY_IP to any port 22 proto tcp comment 'ssh owner'"
if [ "$ROLE" = core ]; then
  run "ufw allow 80/tcp; ufw allow 443/tcp"
  run "ufw allow 10000/udp comment 'jitsi media'"
  run "ufw allow 4443/tcp comment 'jitsi tcp fallback'"
else
  run "ufw allow from $CORE_IP to any port 443 proto tcp comment 'asr from core'"
  run "ufw allow from $CORE_IP to any port 8000 proto tcp comment 'asr api from core'"
fi
run "ufw --force enable"
run "ufw status verbose"

echo "== fail2ban (SSH)"
run "printf '[sshd]\nenabled = true\nmaxretry = 5\nbantime = 1h\n' > /etc/fail2ban/jail.d/tolk-sshd.local; systemctl restart fail2ban"

echo "== Проверка"
run "docker --version; docker compose version"
run "nproc; free -h | sed -n 2p; df -h / | sed -n 2p"
echo "Готово. Роль: $ROLE. Дальше: скопировать hw_probe.sh и запустить './hw_probe.sh 5 <метка>' (см. README.md)."
