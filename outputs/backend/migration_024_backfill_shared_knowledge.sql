-- ============================================================
-- migration_024_backfill_shared_knowledge.sql
--
-- БЛОКЕР, найден при прогоне пути нового психолога.
--
-- Симптом: психолог регистрируется, выбирает свой подход (КПТ, гештальт,
-- психоанализ, схема-терапия, экзистенциальный, интегративный) — и в
-- разделе «База знаний → Тесты» у него пусто. Отправить клиенту методику
-- нельзя вообще ни одну: кнопок «Отправить как тест клиенту» нет, потому
-- что в его knowledge_base нет ни одной записи с source_type='test'.
--
-- Причина: при онбординге база заполнялась строго набором выбранного
-- подхода (APPROACH_SEED_KNOWLEDGE[approach] в src/lib/approaches.ts), а
-- все 17 психодиагностических методик лежат в наборе 'other' вместе с
-- кросс-подходными протоколами и руководствами. Их получал только тот,
-- кто выбрал «Другой подход».
--
-- Логика была неверной: методика не принадлежит школе — шкала депрессии
-- Цунга или PSS-10 одинаково нужны и гештальтисту, и КПТ-терапевту.
--
-- Код онбординга исправлен (теперь к материалам подхода всегда
-- добавляется общий набор), но психологам, зарегистрированным ДО этого
-- исправления, материалы нужно дозалить — этим и занимается миграция.
--
-- ВАЖНО про embedding: колонка заполняется через YandexGPT при
-- онбординге, и SQL посчитать её не может. Поэтому здесь embedding
-- копируется у психолога, у которого эти же материалы уже есть (тексты
-- идентичны, значит и вектор тот же). Если такого психолога в базе нет —
-- миграция ничего не сделает, и материалы нужно досеять из приложения.
--
-- Применять через Supabase SQL Editor. Идемпотентно: повторный запуск
-- ничего не продублирует.
-- ============================================================

insert into knowledge_base (psychologist_id, title, content, embedding, source_type, approach)
select
  p.id            as psychologist_id,
  src.title,
  src.content,
  src.embedding,
  src.source_type,
  'other'         as approach
from psychologists p
cross join lateral (
  -- Эталонный набор общих материалов: берём по одной записи на каждый
  -- уникальный текст у того психолога, у кого они уже есть.
  select distinct on (kb.title, kb.source_type)
    kb.title, kb.content, kb.embedding, kb.source_type
  from knowledge_base kb
  where kb.approach = 'other'
    and kb.embedding is not null
  order by kb.title, kb.source_type, kb.created_at
) src
where not exists (
  -- Не дублируем то, что у психолога уже есть.
  select 1 from knowledge_base existing
  where existing.psychologist_id = p.id
    and existing.title = src.title
    and existing.source_type = src.source_type
)
-- Досеиваем только тем, кто уже прошёл онбординг (у кого база не пустая):
-- у новых психологов всё положит исправленный код онбординга.
and exists (
  select 1 from knowledge_base any_kb where any_kb.psychologist_id = p.id
);

-- Проверка: у каждого психолога должны появиться методики.
-- select p.id, count(*) filter (where kb.source_type = 'test') as tests
-- from psychologists p
-- left join knowledge_base kb on kb.psychologist_id = p.id
-- group by p.id;
