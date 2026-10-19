#!/usr/bin/env bash
# Авто-выкатка МЕЛКИХ UI-фиксов из ветки auto/support-fixes (pull-модель, НА core).
# Cron (каждые 5 минут):  */5 * * * * /home/ubuntu/core/auto_deploy.sh >> /home/ubuntu/tolk-autodeploy.log 2>&1
# Установка: см. deploy/core/OPS.md (раздел «Авто-выкатка»). Выключатель: touch ~/auto-deploy/DISABLED
# Разбор после отказа: rm ~/auto-deploy/rejected  (после того как разобрались/сбросили ветку)
#
# Правила (всё, что не проходит, НЕ выкатывается, а отправляется владельцу в Telegram):
#  - только изменённые/новые файлы src/**/*.tsx|css, без api/, middleware, auth/login/register/billing/payment/supabase;
#  - ≤ 8 файлов и ≤ 300 изменённых строк; без удалений, переименований и бинарных файлов;
#  - в добавленных строках нет fetch/eval/process.env/внешних URL/innerHTML/localStorage и т.п.;
#  - патч накладывается на ~/tolk-src без конфликтов, затем ./core.sh build && up;
#  - /api/health + /login после выкатки; при сбое — ./core.sh rollback и откат исходников.
set -uo pipefail
cd "$(dirname "$0")"
CORE_DIR="$(pwd)"
SRC="$(cd .. && pwd)/tolk-src"
AD="$HOME/auto-deploy"
REPO="$AD/repo.git"
BRANCH="auto/support-fixes"
BASE="infra/frontend-docker-asr-vm-04-10"
REMOTE="${AUTO_DEPLOY_REMOTE:-ssh://git@ssh.github.com:443/Whisper-t3ch/tolk.git}"
MAX_FILES=8; MAX_LINES=300

mkdir -p "$AD"
exec 9>/tmp/tolk-autodeploy.lock; flock -n 9 || exit 0
[ -f "$AD/DISABLED" ] && exit 0
[ -f "$AD/deploy_key" ] || { echo "$(date -u +%FT%TZ) нет $AD/deploy_key" >&2; exit 1; }
export GIT_SSH_COMMAND="ssh -i $AD/deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$AD/known_hosts -o ConnectTimeout=15"

[ -f .alert.env ] && { set -a; . ./.alert.env; set +a; }
getv() { grep -E "^$1=" .env.core 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r"'; }
TG_API="$(getv TELEGRAM_API_BASE)"; TG_API="${TG_API:-https://api.telegram.org}"
APP="$(getv APP_DOMAIN)"
log()    { echo "$(date -u +%FT%TZ) autodeploy: $*"; }
notify() { log "$1"
  if [ -n "${TG_BOT_TOKEN:-}" ] && [ -n "${TG_CHAT_ID:-}" ]; then
    curl -s -m 20 -o /dev/null "$TG_API/bot${TG_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TG_CHAT_ID}" --data-urlencode "text=ТОЛК авто-выкатка: $1" || true
  fi; }

# --- получить ветки ---
[ -d "$REPO" ] || git init -q --bare "$REPO"
git -C "$REPO" ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >"$AD/ls.out" 2>"$AD/ls.err"
rc=$?
if [ "$rc" != 0 ]; then
  [ "$rc" = 2 ] && exit 0                                   # ветки ещё нет — тишина
  log "git ls-remote: $(head -c 200 "$AD/ls.err")"; exit 0   # сеть/ключ — в лог, без спама
fi
git -C "$REPO" fetch -q --no-tags "$REMOTE" "+refs/heads/$BRANCH:refs/ad/tip" "+refs/heads/$BASE:refs/ad/base" 2>"$AD/fetch.err" \
  || { log "git fetch: $(head -c 200 "$AD/fetch.err")"; exit 0; }
G() { git -C "$REPO" "$@"; }

TIP="$(G rev-parse refs/ad/tip)"
if [ -f "$AD/last_applied" ]; then LAST="$(cat "$AD/last_applied")"
else LAST="$(G merge-base refs/ad/tip refs/ad/base)"; echo "$LAST" > "$AD/last_applied"; fi
[ "$TIP" = "$LAST" ] && exit 0
[ "$TIP" = "$(cat "$AD/rejected" 2>/dev/null)" ] && exit 0

reject() { echo "$TIP" > "$AD/rejected"; notify "НЕ выкачено (${TIP:0:7}): $1. Нужен ручной разбор: ветка $BRANCH."; exit 0; }

G merge-base --is-ancestor "$LAST" "$TIP" 2>/dev/null || reject "ветка переписана (${LAST:0:7} не предок)"
SUBJ="$(G log --format=%s -n1 "$TIP")"

# --- проверки диффа ---
bad="$(G diff --name-status "$LAST" "$TIP" | awk '$1!="M" && $1!="A"')"
[ -z "$bad" ] || reject "есть удаления/переименования"
FILES="$(G diff --name-only "$LAST" "$TIP")"
[ -n "$FILES" ] || { echo "$TIP" > "$AD/last_applied"; exit 0; }
[ "$(echo "$FILES" | wc -l)" -le "$MAX_FILES" ] || reject "больше $MAX_FILES файлов"
echo "$FILES" | grep -qvE '^src/.+\.(tsx|css)$' && reject "файл вне allowlist (разрешены src/**/*.tsx|css)"
echo "$FILES" | grep -qiE '(^src/app/api/|middleware|/auth/|login|register|forgot-password|reset-password|billing|payment|supabase)' && reject "затронут чувствительный путь"
G diff --numstat "$LAST" "$TIP" | awk '$1=="-"{b=1} END{exit !b}' && reject "бинарные изменения"
LINES="$(G diff --numstat "$LAST" "$TIP" | awk '{s+=$1+$2} END{print s+0}')"
[ "$LINES" -le "$MAX_LINES" ] || reject "слишком большой дифф ($LINES строк)"
G diff -U0 "$LAST" "$TIP" | grep '^+' | grep -v '^+++' \
  | grep -qE 'fetch\(|XMLHttpRequest|sendBeacon|WebSocket|eval\(|new Function|dangerouslySetInnerHTML|process\.env|https?://|document\.cookie|localStorage|sessionStorage|import\(|require\(|<script|<iframe|window\.location|location\.href|\.innerHTML' \
  && reject "в добавленных строках подозрительные конструкции"

# --- наложить патч ---
[ -d "$SRC" ] || reject "нет $SRC"
G diff --binary "$LAST" "$TIP" > "$AD/p.patch"
if ! (cd "$SRC" && patch -p1 -s --dry-run < "$AD/p.patch" >"$AD/patch.out" 2>&1); then
  if (cd "$SRC" && patch -p1 -s -R --dry-run < "$AD/p.patch" >/dev/null 2>&1); then
    echo "$TIP" > "$AD/last_applied"; log "${TIP:0:7} уже есть в исходниках — пропуск"; exit 0
  fi
  reject "патч не накладывается на tolk-src ($(head -c 150 "$AD/patch.out" | tr '\n' ' '))"
fi
(cd "$SRC" && patch -p1 -s --no-backup-if-mismatch < "$AD/p.patch") || reject "ошибка наложения патча"
revert_src() { (cd "$SRC" && patch -p1 -s -R --no-backup-if-mismatch < "$AD/p.patch") || log "ВНИМАНИЕ: откат исходников не удался"; }

ORIG_COMMIT="$(cat "$SRC/.git_commit" 2>/dev/null || true)"
echo "auto-${TIP:0:7}" > "$SRC/.git_commit"
restore_commit() { [ -n "$ORIG_COMMIT" ] && echo "$ORIG_COMMIT" > "$SRC/.git_commit" || true; }

# --- сборка и выкатка ---
log "сборка ${TIP:0:7}: $SUBJ ($LINES строк, $(echo "$FILES" | wc -l) файл.)"
if ! ./core.sh build >"$AD/build.log" 2>&1; then
  revert_src; restore_commit
  reject "сборка упала (хвост лога: $(tail -n 3 "$AD/build.log" | tr '\n' ' ' | head -c 250))"
fi
./core.sh up >"$AD/up.log" 2>&1
ok=0
for _ in $(seq 1 12); do
  sleep 10
  curl -fsS -m 8 --resolve "$APP:443:127.0.0.1" "https://$APP/api/health" 2>/dev/null | grep -q '"ok":true' \
  && [ "$(curl -s -o /dev/null -m 8 -w '%{http_code}' --resolve "$APP:443:127.0.0.1" "https://$APP/login")" = 200 ] && { ok=1; break; }
done
if [ "$ok" != 1 ]; then
  ./core.sh rollback >"$AD/rollback.log" 2>&1
  revert_src; restore_commit
  reject "после выкатки не прошла проверка /api/health и /login — выполнен откат (rollback)"
fi
echo "$TIP" > "$AD/last_applied"
notify "выкачено ${TIP:0:7}: $SUBJ. Файлы: $(echo "$FILES" | tr '\n' ' ')"
