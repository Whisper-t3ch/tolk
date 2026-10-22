#!/usr/bin/env bash
# Выкатка по pull: НА core каждую минуту смотрит ветку release/prod и выкатывает её последний коммит.
# Cron:  * * * * * /home/ubuntu/core/release_deploy.sh >> /home/ubuntu/tolk-release-deploy.log 2>&1
# Выключатель: touch ~/release-deploy/DISABLED     Снять блокировку после отказа: rm ~/release-deploy/rejected
#
# Что делает: git fetch (read-only deploy key) → если HEAD ветки не равен ~/tolk-src/.git_commit →
#   проверка миграций БД → git archive поверх ~/tolk-src → ./core.sh build && up → проверка /api/health и /login →
#   при сбое ./core.sh rollback и возврат исходников. Итог — в Telegram (.alert.env), как у auto_deploy.sh.
# Разовые SQL-задачи: файлы deploy/ops/NNN_*.sql из ветки выполняются один раз (psql в supabase-db, одной транзакцией),
#   результат приходит в Telegram; выполненные записаны в ~/release-deploy/ops_done. Нужны для выдачи инвайт-кодов и т.п.
#   без захода на сервер. Миграции схемы этим путём НЕ применяются (для них — шлюз migrations_upto ниже).
# Миграции БД автоматически НЕ применяются: если в коммите есть migration_NNN выше номера из ~/release-deploy/migrations_upto,
#   выкатка ждёт (одно уведомление). Применил SQL → echo NNN > ~/release-deploy/migrations_upto → следующая минута выкатит.
set -uo pipefail
cd "$(dirname "$0")"
CORE_DIR="$(pwd)"
SRC="$(cd .. && pwd)/tolk-src"
RD="$HOME/release-deploy"
AD="$HOME/auto-deploy"
REPO="$RD/repo.git"
BRANCH="${RELEASE_BRANCH:-release/prod}"
REMOTE="${AUTO_DEPLOY_REMOTE:-ssh://git@ssh.github.com:443/Whisper-t3ch/tolk.git}"
MIG_DIR="outputs/backend"

mkdir -p "$RD"
# Общий замок с auto_deploy.sh: две выкатки одновременно не идут.
exec 9>/tmp/tolk-autodeploy.lock; flock -n 9 || exit 0
[ -f "$RD/DISABLED" ] && exit 0
KEY="$RD/deploy_key"; [ -f "$KEY" ] || KEY="$AD/deploy_key"
[ -f "$KEY" ] || { echo "$(date -u +%FT%TZ) release: нет deploy_key" >&2; exit 1; }
export GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$RD/known_hosts -o ConnectTimeout=15"

[ -f .alert.env ] && { set -a; . ./.alert.env; set +a; }
getv() { grep -E "^$1=" .env.core 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r"'; }
TG_API="$(getv TELEGRAM_API_BASE)"; TG_API="${TG_API:-https://api.telegram.org}"
APP="$(getv APP_DOMAIN)"
log()    { echo "$(date -u +%FT%TZ) release: $*"; }
notify() { log "$1"
  if [ -n "${TG_BOT_TOKEN:-}" ] && [ -n "${TG_CHAT_ID:-}" ]; then
    curl -s -m 20 -o /dev/null "$TG_API/bot${TG_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TG_CHAT_ID}" --data-urlencode "text=ТОЛК выкатка: $1" || true
  fi; }

[ -d "$REPO" ] || git init -q --bare "$REPO"
G() { git -C "$REPO" "$@"; }

G ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >"$RD/ls.out" 2>"$RD/ls.err"
rc=$?
if [ "$rc" != 0 ]; then
  [ "$rc" = 2 ] && exit 0
  log "git ls-remote: $(head -c 200 "$RD/ls.err")"; exit 0
fi
TIP="$(cut -f1 "$RD/ls.out" | head -1)"
SHORT="${TIP:0:7}"

# --- разовые SQL-задачи из deploy/ops/ (выполняются независимо от выкатки кода) ---
run_ops() {
  [ "$(cat "$RD/ops_seen" 2>/dev/null)" = "$TIP" ] && return 0
  G fetch -q --no-tags "$REMOTE" "+refs/heads/$BRANCH:refs/rd/tip" 2>"$RD/fetch.err" || return 0
  local tip files f out rc
  tip="$(G rev-parse refs/rd/tip)"
  files="$(G ls-tree --name-only "$tip" deploy/ops/ 2>/dev/null | sed -n 's#^deploy/ops/\([0-9]\{3\}_[A-Za-z0-9_.-]*\.sql\)$#\1#p' | sort)"
  for f in $files; do
    grep -qxF "$f" "$RD/ops_done" 2>/dev/null && continue
    echo "$f" >> "$RD/ops_done"       # помечаем до запуска: сбойная задача не крутится по кругу
    G show "$tip:deploy/ops/$f" > "$RD/ops_task.sql" 2>/dev/null || { notify "SQL-задача $f: не удалось прочитать"; continue; }
    out="$(sudo docker exec -i supabase-db psql -X -q -P pager=off -v ON_ERROR_STOP=1 -1 -U supabase_admin -d postgres < "$RD/ops_task.sql" 2>&1)"; rc=$?
    rm -f "$RD/ops_task.sql"
    if [ "$rc" = 0 ]; then notify "SQL-задача $f выполнена:
$(printf '%s' "$out" | head -c 3500)"
    else notify "SQL-задача $f ОШИБКА (откат, не повторяется):
$(printf '%s' "$out" | tail -c 1500)"; fi
  done
  echo "$TIP" > "$RD/ops_seen"
}
run_ops

CUR="$(cat "$SRC/.git_commit" 2>/dev/null || true)"
[ "$CUR" = "$SHORT" ] && exit 0                                  # уже выкачено (в том числе вручную снапшотом)
[ "$TIP" = "$(cat "$RD/rejected" 2>/dev/null)" ] && exit 0

G fetch -q --no-tags "$REMOTE" "+refs/heads/$BRANCH:refs/rd/tip" 2>"$RD/fetch.err" \
  || { log "git fetch: $(head -c 200 "$RD/fetch.err")"; exit 0; }
TIP="$(G rev-parse refs/rd/tip)"; SHORT="${TIP:0:7}"
[ "$CUR" = "$SHORT" ] && exit 0
SUBJ="$(G log --format=%s -n1 "$TIP")"

reject() { echo "$TIP" > "$RD/rejected"; notify "НЕ выкачено ${SHORT} ($SUBJ): $1"; exit 0; }

# --- миграции БД ---
UPTO=""; [ -f "$RD/migrations_upto" ] && UPTO="$(tr -dc '0-9' < "$RD/migrations_upto")"
if [ -z "$UPTO" ]; then log "нет $RD/migrations_upto (напр. echo 050 > $RD/migrations_upto)"; exit 0; fi
NEWMIG="$(G ls-tree --name-only "$TIP" "$MIG_DIR/" 2>/dev/null | sed -n 's#.*migration_\([0-9]\{3\}\)_.*#\1#p' | sort -u | awk -v u="$((10#$UPTO))" '($1+0)>u')"
if [ -n "$NEWMIG" ]; then
  if [ "$(cat "$RD/gate_notified" 2>/dev/null)" != "$TIP" ]; then
    echo "$TIP" > "$RD/gate_notified"
    notify "ЖДЁТ МИГРАЦИЮ: коммит ${SHORT} ($SUBJ) содержит migration_$(echo $NEWMIG | tr ' ' ',') (файлы в $MIG_DIR). Примените SQL в supabase-db, затем: echo $(echo $NEWMIG | tr ' ' '\n' | tail -1) > ~/release-deploy/migrations_upto — выкатка пойдёт сама."
  fi
  exit 0
fi

# --- исходники ---
[ -d "$SRC" ] || reject "нет $SRC"
PREV_TIP=""
[ -n "$CUR" ] && PREV_TIP="$(G rev-parse -q --verify "refs/rd/prev^{commit}" 2>/dev/null || true)"
extract() { G archive "$1" | tar -x -C "$SRC"; }
log "сборка ${SHORT}: $SUBJ"
extract "$TIP" || reject "не удалось распаковать исходники"
echo "$SHORT" > "$SRC/.git_commit"
# Скрипты деплоя обновляются из выкатываемого коммита ДО сборки (mv — безопасно для уже запущенного bash).
sync_script() {
  local f="$1" src="$SRC/deploy/core/$1"
  [ -f "$src" ] || return 0
  sed 's/\r$//' "$src" > "$CORE_DIR/$f.new" || { rm -f "$CORE_DIR/$f.new"; return 0; }
  case "$f" in *.sh) bash -n "$CORE_DIR/$f.new" 2>/dev/null || { rm -f "$CORE_DIR/$f.new"; return 0; } ;; esac
  if cmp -s "$CORE_DIR/$f.new" "$CORE_DIR/$f"; then rm -f "$CORE_DIR/$f.new"; else chmod +x "$CORE_DIR/$f.new" && mv "$CORE_DIR/$f.new" "$CORE_DIR/$f"; log "обновлён $f"; fi
}
sync_script core.sh
sync_script release_deploy.sh
sync_script seed_platform_kb.sql
sync_script reindex_embeddings.sh
revert_src() {
  if [ -n "$PREV_TIP" ]; then extract "$PREV_TIP" || log "ВНИМАНИЕ: возврат исходников не удался"; fi
  [ -n "$CUR" ] && echo "$CUR" > "$SRC/.git_commit" || true
}

# Логи web перед пересозданием контейнера (иначе при выкатке пропадают): ~/release-deploy/weblogs/, хранятся 14 дней.
archive_web_logs() {
  local c; c="$(sudo docker ps -q --filter label=com.docker.compose.service=web | head -1)"
  [ -n "$c" ] || return 0
  mkdir -p "$RD/weblogs"
  sudo docker logs "$c" > "$RD/weblogs/web-$(date -u +%Y%m%d-%H%M%S)-${CUR:-x}.log" 2>&1 || true
  find "$RD/weblogs" -type f -mtime +14 -delete 2>/dev/null || true
}
archive_web_logs

if ! ./core.sh build >"$RD/build.log" 2>&1; then
  revert_src
  reject "сборка упала (хвост лога: $(tail -n 3 "$RD/build.log" | tr '\n' ' ' | head -c 250))"
fi
./core.sh up >"$RD/up.log" 2>&1
ok=0
for _ in $(seq 1 12); do
  sleep 10
  curl -fsS -m 8 --resolve "$APP:443:127.0.0.1" "https://$APP/api/health" 2>/dev/null | grep -q '"ok":true' \
  && [ "$(curl -s -o /dev/null -m 8 -w '%{http_code}' --resolve "$APP:443:127.0.0.1" "https://$APP/login")" = 200 ] && { ok=1; break; }
done
if [ "$ok" != 1 ]; then
  ./core.sh rollback >"$RD/rollback.log" 2>&1
  revert_src
  reject "после выкатки не прошла проверка /api/health и /login — выполнен откат (rollback)"
fi
G update-ref refs/rd/prev "$TIP"
rm -f "$RD/rejected" "$RD/gate_notified"
notify "выкачено ${SHORT}: $SUBJ"
