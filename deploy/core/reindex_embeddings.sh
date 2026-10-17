#!/usr/bin/env bash
# Эмбеддинги на GigaChat. Запуск на core из ~/core:
#   ./reindex_embeddings.sh probe    — проверить модель эмбеддингов и размерность (ничего не меняет)
#   ./reindex_embeddings.sh migrate  — перевести vector-колонки на 1024 (старые эмбеддинги обнулятся)
#   ./reindex_embeddings.sh seed-kb  — загрузить справочные статьи о платформе в базу знаний (без эмбеддингов)
#   ./reindex_embeddings.sh run      — посчитать эмбеддинги: база знаний, чанки, транскрипты без чанков
set -euo pipefail
cd "$(dirname "$0")"
trap 'rm -f /tmp/emb_in.jsonl /tmp/emb_out.sql' EXIT
SB="$HOME/supabase"; set -a; . "$SB/.env"; set +a
psql_() { sudo docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" supabase-db psql -v ON_ERROR_STOP=1 -h localhost -U supabase_admin -d postgres "$@"; }
sudo docker cp reindex_embeddings.mjs core-web-1:/tmp/reindex_embeddings.mjs >/dev/null
case "${1:-}" in
  probe)
    echo '{"kind":"kb","id":"00000000-0000-0000-0000-000000000000","text":"проверка эмбеддинга"}' \
      | sudo docker exec -i core-web-1 node /tmp/reindex_embeddings.mjs >/dev/null
    psql_ -At -c "select c.relname||'.'||a.attname||' vector('||a.atttypmod||')' from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where a.atttypid=(select oid from pg_type where typname='vector' limit 1) and n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped"
    ;;
  migrate)
    psql_ -f - < embeddings_to_1024.sql
    ;;
  seed-kb)
    psql_ -At -f - < seed_platform_kb.sql
    ;;
  run)
    psql_ -At -c "
      select json_build_object('kind','kb','id',id,'text',content) from public.knowledge_base where embedding is null
      union all
      select json_build_object('kind','chunk','id',id,'text',chunk_text) from public.session_transcript_chunks where embedding is null
      union all
      select json_build_object('kind','transcript','session_id',t.session_id,'text',t.raw_text)
        from (select distinct on (session_id) session_id, raw_text from public.session_transcripts where raw_text is not null order by session_id, created_at desc) t
        where not exists (select 1 from public.session_transcript_chunks c where c.session_id = t.session_id)
    " > /tmp/emb_in.jsonl
    echo "К обработке: $(wc -l < /tmp/emb_in.jsonl) записей"
    sudo docker exec -i core-web-1 node /tmp/reindex_embeddings.mjs < /tmp/emb_in.jsonl > /tmp/emb_out.sql
    psql_ -q -f - < /tmp/emb_out.sql
    rm -f /tmp/emb_in.jsonl /tmp/emb_out.sql
    psql_ -At -c "select 'kb: '||count(*) filter (where embedding is not null)||'/'||count(*) from public.knowledge_base union all select 'чанки: '||count(*) filter (where embedding is not null)||'/'||count(*) from public.session_transcript_chunks"
    ;;
  *) echo "usage: $0 probe|migrate|seed-kb|run" >&2; exit 1 ;;
esac
