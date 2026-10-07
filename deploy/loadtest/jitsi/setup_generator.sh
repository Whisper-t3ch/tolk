#!/usr/bin/env bash
# Подготовка ВМ-генератора (Ubuntu 22.04): Node 22 + Playwright + Chromium. Запуск: ./setup_generator.sh   (~3-5 мин)
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
npm install --no-audit --no-fund
sudo npx playwright install --with-deps chromium
echo "готово: node $(node -v), playwright установлен"
