-- ============================================================
-- migration_019_dedupe_knowledge_base_by_content.sql
--
-- Продолжение чистки после migration_018 (та убрала только дубли
-- шаблонов протоколов, различавшиеся суффиксом в названии).
--
-- Сквозной прогон показал ещё один случай: техника с полностью
-- идентичным текстом (432 символа) лежит в базе дважды под разными
-- названиями — «SMART-цели в терапевтическом контракте» (5 сентября)
-- и «Конкретные измеримые цели в терапевтическом контракте»
-- (6 сентября). Такие дубли удваивают один и тот же фрагмент в
-- RAG-выдаче ассистента (match_knowledge_base) и в списках раздела
-- «База знаний».
--
-- Правило здесь общее, а не под конкретную пару: среди записей одного
-- психолога с одинаковыми source_type и content оставляем самую
-- раннюю по created_at, остальные удаляем. Это покрывает и будущие
-- повторные прогоны сидирования.
--
-- Применять через Supabase SQL Editor. Идемпотентно.
-- ============================================================

-- Шаг 1. Переносим ссылки из заметок сессий на остающуюся (самую
-- раннюю) запись, чтобы не потерять выбранный шаблон протокола.
update soap_notes sn
set protocol_template_id = keep.id
from knowledge_base dup
join lateral (
  select k.id
  from knowledge_base k
  where k.psychologist_id = dup.psychologist_id
    and k.source_type = dup.source_type
    and k.content = dup.content
  order by k.created_at, k.id
  limit 1
) keep on keep.id <> dup.id
where sn.protocol_template_id = dup.id;

-- Шаг 2. Удаляем все копии кроме самой ранней.
delete from knowledge_base kb
where kb.id in (
  select id from (
    select
      id,
      row_number() over (
        partition by psychologist_id, source_type, content
        order by created_at, id
      ) as rn
    from knowledge_base
  ) ranked
  where ranked.rn > 1
);

-- Проверка результата: должно вернуть 0 строк.
-- select psychologist_id, source_type, left(content, 60) as head, count(*)
-- from knowledge_base
-- group by psychologist_id, source_type, content
-- having count(*) > 1;
