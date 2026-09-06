-- ============================================================
-- migration_010_knowledge_base_topics_tests.sql
--
-- Расширение базы знаний по итогам обратной связи (2026-09-06):
-- 1. 'test' как допустимое значение knowledge_base.source_type —
--    отдельный раздел "Тесты" (открытые/российские диагностические
--    методики), до этого такие материалы лежали как 'article'.
-- 2. knowledge_base.topic — тема/проблема материала (тревога,
--    depression, отношения и т.д.) для группировки и фильтрации в UI
--    вместо плоского списка по approach. Свободный текст, не enum —
--    список тем меняется быстрее, чем стоило бы жёстко фиксировать
--    его в CHECK constraint.
--
-- Применять через Supabase SQL Editor. Все операции идемпотентны —
-- безопасно применять повторно.
-- ============================================================

alter table knowledge_base
  add column if not exists topic text;

comment on column knowledge_base.topic is
  'Тема/проблема материала для группировки и фильтрации в UI (например: тревога, отношения, самооценка). Свободный текст, не enum.';

do $$
declare
  constraint_name_var text;
begin
  select tc.constraint_name into constraint_name_var
  from information_schema.constraint_column_usage ccu
  join information_schema.table_constraints tc on tc.constraint_name = ccu.constraint_name
  where ccu.table_name = 'knowledge_base'
    and ccu.column_name = 'source_type'
    and tc.constraint_type = 'CHECK';

  if constraint_name_var is not null then
    execute format('alter table knowledge_base drop constraint %I', constraint_name_var);
  end if;
end $$;

alter table knowledge_base add constraint knowledge_base_source_type_check
  check (source_type in ('technique', 'article', 'protocol', 'manual', 'homework', 'test'));

create index if not exists idx_knowledge_base_topic on knowledge_base(topic);
