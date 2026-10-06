#!/usr/bin/env bash
# Перенос СХЕМЫ public (таблицы, RLS-политики, функции, права, триггеры public) из облачного Supabase
# в локальный стек + триггер регистрации + бакет записей. Пользователи и сессии НЕ переносятся
# (в облаке только тестовые данные; новый стек стартует чистым). Облачная БД не изменяется (только чтение).
# Дополнительно можно скопировать данные справочных таблиц: DATA_TABLES="knowledge_base" ./migrate_from_cloud.sh
# Запускать на сервере из ~/supabase ПОСЛЕ ./sb.sh up (все контейнеры healthy).
set -euo pipefail
cd "$(dirname "$0")"
umask 077

# shellcheck disable=SC1091
set -a; . ./.env; set +a
DATA_TABLES="${DATA_TABLES:-knowledge_base}"

read -rsp "Строка подключения к ОБЛАЧНОЙ БД (Supabase -> Connect -> Session pooler, с паролем): " CLOUD_DB_URL; echo
[ -n "$CLOUD_DB_URL" ] || { echo "Пустая строка подключения"; exit 1; }

dexec()  { sudo docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" supabase-db "$@"; }
local_psql_admin() { dexec psql -v ON_ERROR_STOP=1 -h localhost -U supabase_admin -d postgres "$@"; }
local_psql_pg()    { dexec psql -v ON_ERROR_STOP=1 -h localhost -U postgres       -d postgres "$@"; }
cloud() { sudo docker exec -i -e U="$CLOUD_DB_URL" supabase-db sh -c "$1"; }

echo "== 1/6 Проверка связи с облачной БД (read-only)"
cloud 'psql "$U" -At -c "select current_database(), version()"' | head -2

echo "== 2/6 Расширения в локальной БД"
local_psql_admin -c 'create extension if not exists vector with schema public;' \
                 -c 'create extension if not exists pgcrypto with schema extensions;' \
                 -c 'create extension if not exists "uuid-ossp" with schema extensions;'

echo "== 3/6 Дамп схемы public из облака -> schema_public.sql"
cloud 'pg_dump "$U" --schema-only --no-owner -n public' | sed '/^CREATE SCHEMA public;$/d' > schema_public.sql
echo "   строк: $(wc -l < schema_public.sql)"

echo "== 4/6 Восстановление схемы (роль postgres)"
local_psql_pg < schema_public.sql

echo "== 5/6 Триггер регистрации + бакет (post_restore.sql)"
local_psql_admin < post_restore.sql

if [ -n "$DATA_TABLES" ]; then
  echo "== 5b Данные справочных таблиц: $DATA_TABLES"
  for t in $DATA_TABLES; do
    if cloud "pg_dump \"\$U\" --data-only --column-inserts --no-owner -t public.$t" | local_psql_pg >/dev/null; then
      echo "   $t: скопирована"
    else
      echo "   ВНИМАНИЕ: $t не скопировалась (зависимости?). Продолжаю; справочник можно залить seed-скриптом."
    fi
  done
fi

echo "== 6/6 Сверка прав и RLS: облако vs локально (должно совпасть)"
Q_FUNCS="select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|a='||has_function_privilege('anon',p.oid,'execute')||'|u='||has_function_privilege('authenticated',p.oid,'execute')||'|s='||has_function_privilege('service_role',p.oid,'execute') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1;"
Q_TABS="select c.relname||'|rls='||c.relrowsecurity||'|a='||has_table_privilege('anon',c.oid,'select')||'|u='||has_table_privilege('authenticated',c.oid,'select')||'|s='||has_table_privilege('service_role',c.oid,'select') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1;"
{ echo "$Q_FUNCS"; echo "$Q_TABS"; } | cloud 'psql "$U" -At' > /tmp/priv_cloud.txt
{ echo "$Q_FUNCS"; echo "$Q_TABS"; } | dexec psql -h localhost -U supabase_admin -d postgres -At > /tmp/priv_local.txt
if diff -u /tmp/priv_cloud.txt /tmp/priv_local.txt > /tmp/priv_diff.txt; then
  echo "   ПРАВА И RLS СОВПАДАЮТ ($(wc -l < /tmp/priv_local.txt) объектов)"
else
  echo "   РАСХОЖДЕНИЯ (первые 40 строк; формат: функция/таблица|a=anon|u=authenticated|s=service_role):"
  head -40 /tmp/priv_diff.txt
  echo "   Особенно важно: функция claim_recording_job НЕ должна быть доступна anon/authenticated (a=false, u=false)."
fi
rm -f /tmp/priv_cloud.txt /tmp/priv_local.txt
unset CLOUD_DB_URL
echo "Готово. Дальше: ./sb.sh smoke"
