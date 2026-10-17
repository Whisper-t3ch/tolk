#!/usr/bin/env bash
# Сверка облако vs локально: число строк по каждой таблице public, auth.users, auth.identities. Код возврата 1 при расхождениях.
# Запуск НА core из ~/supabase:  ./verify_migration.sh   (строка подключения к облаку спросится скрытно)
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
set -a; . ./.env; set +a
[ -n "${CLOUD_DB_URL:-}" ] || { read -rsp "Строка подключения к ОБЛАЧНОЙ БД: " CLOUD_DB_URL; echo; }
dexec() { sudo docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" supabase-db "$@"; }
lpsql() { dexec psql -h localhost -U supabase_admin -d postgres -At "$@"; }
cloud() { sudo docker exec -i -e U="$CLOUD_DB_URL" supabase-db sh -c "$1"; }

tables="$(lpsql -c "select 'public.'||tablename from pg_tables where schemaname='public' order by 1"; echo auth.users; echo auth.identities)"
bad=0; printf '%-46s %10s %10s\n' таблица облако локально
while read -r t; do
  [ -n "$t" ] || continue
  c="$(cloud "psql \"\$U\" -At -c 'select count(*) from $t'" 2>/dev/null || echo ERR)"
  l="$(lpsql -c "select count(*) from $t" 2>/dev/null || echo ERR)"
  mark=""; [ "$c" = "$l" ] || { mark="  <-- РАСХОЖДЕНИЕ"; bad=1; }
  printf '%-46s %10s %10s%s\n' "$t" "$c" "$l" "$mark"
done <<< "$tables"
[ "$bad" = 0 ] && echo "OK: счётчики совпадают." || { echo "ЕСТЬ РАСХОЖДЕНИЯ"; exit 1; }
