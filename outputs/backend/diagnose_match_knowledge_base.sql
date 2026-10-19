-- ============================================================
-- diagnose_match_knowledge_base.sql — НЕ миграция, только чтение.
--
-- Зачем: нужно наполнить knowledge_base платформенными статьями
-- (про часовой пояс, тарифы, Telegram-бота и т.д.), которые должен
-- находить search_knowledge_base у ЛЮБОГО психолога, а не только у
-- одного. Сама функция match_knowledge_base не сохранена в git
-- (создавалась разово через SQL Editor) — прежде чем решать, как
-- вставлять данные, нужно увидеть её реальное тело: фильтрует ли
-- она psychologist_id строго через "=", или там уже заложена
-- лазейка вида "match_psychologist_id is null or psychologist_id
-- = match_psychologist_id" для общих материалов.
--
-- Второй запрос показывает CHECK-constraint на source_type — уже
-- известно из кода (technique/article/protocol/manual/homework/test),
-- но полезно свериться, что в базе тот же список, без сюрпризов.
-- ============================================================

select pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'match_knowledge_base';

select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
where rel.relname = 'knowledge_base'
  and con.contype = 'c';

-- На что смотреть:
--   • В теле функции — есть ли "match_psychologist_id is null" или
--     подобная развилка. Если нет — придётся вставлять platform-
--     статьи КАЖДОМУ существующему психологу отдельными строками
--     (как уже делает migration_024_backfill_shared_knowledge.sql
--     для общих тестов) и дополнить сидинг для новых психологов.
--   • Есть ли фильтр по source_type внутри функции (может быть
--     жёстко зашит список типов, тогда 'manual' точно пройдёт, а
--     новый 'platform' — нет, если его не добавлять в constraint).
