#!/usr/bin/env bash
# Ежедневный бэкап: логический дамп всей БД (public + auth + storage-метаданные) и файлы хранилища.
# Хранит BACKUP_KEEP_DAYS (по умолчанию 14) дней локально; если задан RCLONE_REMOTE (например yos:tolk-backups) —
# дополнительно копирует в Object Storage (rclone должен быть настроен отдельно).
# Cron (пользовательский crontab, НЕ связан с Vercel Cron):  15 3 * * * /home/ubuntu/supabase/backup_db.sh >> /var/log/tolk-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
umask 077
# shellcheck disable=SC1091
set -a; . ./.env; set +a
OUT="${BACKUP_DIR:-/var/backups/tolk}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
sudo mkdir -p "$OUT"; sudo chown "$(id -u):$(id -g)" "$OUT"

echo "[$TS] dump БД"
sudo docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" supabase-db \
  pg_dump -h localhost -U supabase_admin -d postgres -Fc --no-owner > "$OUT/db_$TS.dump"
echo "[$TS] файлы хранилища"
sudo tar -C volumes -czf "$OUT/storage_$TS.tar.gz" storage 2>/dev/null || echo "   (каталог storage пуст/отсутствует)"
ls -lh "$OUT"/*_"$TS".* | awk '{print "   "$5"  "$9}'

if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$OUT" "$RCLONE_REMOTE" --include "*_$TS.*" && echo "[$TS] выгружено в $RCLONE_REMOTE"
fi
find "$OUT" -type f \( -name 'db_*.dump' -o -name 'storage_*.tar.gz' \) -mtime +"$KEEP" -delete
echo "[$TS] готово"
# Проверка восстановимости (раз в неделю вручную): создать пустой стек и
#   cat db_<ts>.dump | sudo docker exec -i supabase-db pg_restore -U supabase_admin -d postgres --clean --if-exists --no-owner
