#!/usr/bin/env bash
# Перенос ДАННЫХ из облачного Supabase в локальный стек (public + auth.users + auth.identities).
# Схема должна быть уже перенесена (migrate_from_cloud.sh). Облако только читается.
# ВНИМАНИЕ: в локальной БД ТЕСТОВЫЕ данные public и auth ЗАМЕНЯЮТСЯ данными облака (перед этим делается бэкап backup_db.sh).
# Запуск НА core из ~/supabase:   ./migrate_data.sh        (спросит строку подключения скрытно и подтверждение)
#   FORCE=1  без вопроса подтверждения   KEEP=1  не удалять временные дампы (там персональные данные!)
# Хранилище записей копируется отдельно: ./migrate_storage.py ; сверка: ./verify_migration.sh
set -euo pipefail
cd "$(dirname "$0")"
umask 077
# shellcheck disable=SC1091
set -a; . ./.env; set +a
[ -n "${CLOUD_DB_URL:-}" ] || { read -rsp "Строка подключения к ОБЛАЧНОЙ БД (Session pooler, с паролем): " CLOUD_DB_URL; echo; }
[ -n "$CLOUD_DB_URL" ] || { echo "Пустая строка подключения" >&2; exit 1; }
dexec()  { sudo docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" supabase-db "$@"; }
lpsql()  { dexec psql -v ON_ERROR_STOP=1 -h localhost -U supabase_admin -d postgres "$@"; }
cloud()  { sudo docker exec -i -e U="$CLOUD_DB_URL" supabase-db sh -c "$1"; }

T="$(mktemp -d "$HOME/migrate_tmp.XXXXXX")"
cleanup() { if [ "${KEEP:-0}" = 1 ]; then echo "Дампы оставлены: $T (персональные данные, удалите вручную)"; else rm -rf "$T"; fi; }
trap cleanup EXIT

echo "== 1/6 Связь с облаком (read-only) и локальной БД"
cloud 'psql "$U" -At -c "select current_database()"' | head -1
lpsql -At -c "select count(*) from public.psychologists" | sed 's/^/   локально психологов сейчас: /'

if [ "${FORCE:-0}" != 1 ]; then
  echo "Локальные данные public и auth будут ЗАМЕНЕНЫ данными облака."
  read -rp "Введите YES для продолжения: " ans; [ "$ans" = YES ] || { echo "Отменено"; exit 1; }
fi

echo "== 2/6 Бэкап локальной БД перед заменой"
./backup_db.sh >/dev/null && echo "   бэкап сделан (см. каталог бэкапов)"

echo "== 3/6 Дамп данных из облака"
cloud 'pg_dump "$U" --data-only --no-owner -n public' > "$T/public_data.sql"
cloud 'psql "$U" -At -c "select coalesce(json_agg(t),'"'"'[]'"'"'::json) from auth.users t"' > "$T/auth_users.json"
cloud 'psql "$U" -At -c "select coalesce(json_agg(t),'"'"'[]'"'"'::json) from auth.identities t"' > "$T/auth_identities.json"
echo "   public: $(wc -l < "$T/public_data.sql") строк; users: $(python3 -c "import json,sys;print(len(json.load(open('$T/auth_users.json'))))"), identities: $(python3 -c "import json,sys;print(len(json.load(open('$T/auth_identities.json'))))")"

echo "== 4/6 Сборка загрузочного скрипта"
{
  echo "begin;"
  echo "set session_replication_role = replica;"   # не срабатывают триггеры (on_auth_user_created) и FK при загрузке; порядок таблиц не важен
  cat <<'SQL'
do $do$ declare r record; begin
  for r in select tablename from pg_tables where schemaname='public' loop
    execute format('truncate table public.%I restart identity cascade', r.tablename);
  end loop;
end $do$;
truncate table auth.users cascade;
SQL
  # auth.*: через jsonb_populate_recordset, чтобы пережить различия колонок между облаком и локальной версией GoTrue (сгенерированные колонки пропускаются)
  for tbl in users identities; do
    echo "do \$do\$ declare cols text; begin"
    echo "  select string_agg(quote_ident(column_name), ',' order by ordinal_position) into cols from information_schema.columns where table_schema='auth' and table_name='$tbl' and is_generated='NEVER';"
    echo "  execute format('insert into auth.$tbl (%s) select %s from jsonb_populate_recordset(null::auth.$tbl, %L::jsonb)', cols, cols, \$j\$"
    cat "$T/auth_$tbl.json"
    echo "\$j\$);"
    echo "end \$do\$;"
  done
  cat "$T/public_data.sql"
  echo "commit;"
} > "$T/load.sql"

echo "== 5/6 Загрузка в локальную БД (одна транзакция: при ошибке ничего не изменится)"
lpsql < "$T/load.sql" >/dev/null
lpsql -c "analyze;" >/dev/null

echo "== 6/6 Итог"
lpsql -At -c "select 'auth.users: '||count(*) from auth.users" -c "select 'auth.identities: '||count(*) from auth.identities" -c "select 'public.psychologists: '||count(*) from public.psychologists" -c "select 'public.clients: '||count(*) from public.clients" -c "select 'public.sessions: '||count(*) from public.sessions"
echo "Дальше: ./verify_migration.sh (сверка со всем облаком) и ./migrate_storage.py (записи)."
