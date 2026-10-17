-- Переход эмбеддингов с YandexGPT (256 чисел) на GigaChat Embeddings (1024 числа).
-- Меняет размерность ВСЕХ vector-колонок в public, пересоздаёт их индексы.
-- Старые эмбеддинги обнуляются (они несовместимы с новой моделью) — затем ./reindex_embeddings.sh run.
-- Функции match_* менять не нужно: Postgres не хранит размерность в типах аргументов функций.
begin;
do $$
declare
  r record; defs text[]; d text; target int := 1024;
  vec oid := (select oid from pg_type where typname = 'vector' limit 1);
begin
  for r in
    select n.nspname sch, c.relname tbl, a.attname col, a.attnum num, c.oid reloid
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where a.atttypid = vec and n.nspname = 'public' and c.relkind = 'r'
      and a.attnum > 0 and not a.attisdropped and a.atttypmod <> target
  loop
    select coalesce(array_agg(pg_get_indexdef(i.indexrelid)), '{}') into defs
      from pg_index i where i.indrelid = r.reloid and r.num = any(i.indkey::int2[]);
    for d in select i.indexrelid::regclass::text from pg_index i
             where i.indrelid = r.reloid and r.num = any(i.indkey::int2[]) loop
      execute 'drop index ' || d;
    end loop;
    execute format('alter table %I.%I alter column %I type vector(%s) using null', r.sch, r.tbl, r.col, target);
    foreach d in array defs loop execute d; end loop;
    raise notice '% . % -> vector(%), индексов пересоздано: %', r.tbl, r.col, target, coalesce(array_length(defs, 1), 0);
  end loop;
  -- Кэш справочных ответов держится на эмбеддингах вопросов — без них он бесполезен.
  if to_regclass('public.reference_answer_cache') is not null then
    delete from public.reference_answer_cache;
  end if;
end $$;
commit;
