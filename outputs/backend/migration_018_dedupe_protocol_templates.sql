-- ============================================================
-- migration_018_dedupe_protocol_templates.sql
--
-- Найдено при сквозном прогоне интерфейса: в выпадающем списке
-- «Формат протокола» на странице /session/[id]/soap каждый из пяти
-- базовых шаблонов показывался дважды — например «Индивидуальная
-- консультация — шаблон протокола» и «Индивидуальная консультация»
-- с полностью идентичным содержимым (сидирование базы знаний 6 сентября
-- отработало дважды: в 07:41 с суффиксом в названии и в 08:29 без него).
--
-- Дубли мешают не только в этом списке: они удваивают одни и те же
-- куски в RAG-выдаче ассистента (match_knowledge_base) и засоряют
-- раздел «База знаний».
--
-- Оставляем вариант с суффиксом «— шаблон протокола»: именно по нему
-- страница протокола отличает форматы записи от терапевтических
-- протоколов вмешательства и раскладывает их по разным optgroup.
--
-- Применять через Supabase SQL Editor. Идемпотентно: повторный запуск
-- ничего не удалит, т.к. дублей уже не останется.
-- ============================================================

-- Шаг 1. Переносим возможные ссылки из заметок сессий на остающуюся
-- запись, чтобы не потерять «каким шаблоном заполняли протокол»
-- (в soap_notes.protocol_template_id стоит on delete set null).
update soap_notes sn
set protocol_template_id = keep.id
from knowledge_base dup
join knowledge_base keep
  on keep.source_type = 'protocol'
 and keep.psychologist_id = dup.psychologist_id
 and keep.content = dup.content
 and keep.title like '%шаблон протокола%'
 and keep.id <> dup.id
where sn.protocol_template_id = dup.id
  and dup.source_type = 'protocol'
  and dup.title not like '%шаблон протокола%';

-- Шаг 2. Удаляем дубли без суффикса — только те, у которых существует
-- запись с идентичным содержимым у того же психолога и с суффиксом.
delete from knowledge_base dup
where dup.source_type = 'protocol'
  and dup.title not like '%шаблон протокола%'
  and exists (
    select 1
    from knowledge_base keep
    where keep.source_type = 'protocol'
      and keep.psychologist_id = dup.psychologist_id
      and keep.content = dup.content
      and keep.title like '%шаблон протокола%'
      and keep.id <> dup.id
  );

-- Проверка результата: должно вернуть 0 строк.
-- select content, count(*) from knowledge_base
-- where source_type = 'protocol' group by content, psychologist_id
-- having count(*) > 1;
