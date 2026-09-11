-- ============================================================
-- migration_021_test_results_allow_all_questionnaires.sql
--
-- БЛОКЕР БЕТЫ, найден сразу после починки RLS (migration_020).
--
-- Симптом: «База знаний → Тесты → Отправить как тест клиенту» падает с
--   new row for relation "test_results" violates check constraint
--   "test_results_test_type_check"
-- для любой методики, кроме пяти старых клинических шкал.
--
-- Причина: test_results.test_type ограничен CHECK-constraint из ранней
-- схемы, где допустимыми были только PHQ9 / GAD7 / WHO5 / PCL5 / BDI
-- (ровно тип TestType из src/lib/testScales.ts). Когда тесты стали
-- интерактивными опросниками (migration_011..016), в test_type начали
-- писать ключ из справочника test_questionnaires — PRIKHOZHAN, ZUNG,
-- TAS26, BOYKO_EMPATHY и так далее. Ограничение никто не расширил,
-- поэтому назначить клиенту можно было только 5 методик из 22.
--
-- Решение: снять устаревший CHECK и заменить его внешним ключом на
-- справочник test_questionnaires(test_key). Так список допустимых
-- значений перестаёт быть захардкоженным в схеме: любая методика,
-- добавленная в справочник, сразу становится валидной, а мусорные
-- значения по-прежнему не проходят.
--
-- Применять через Supabase SQL Editor. Идемпотентно.
-- ============================================================

-- Шаг 1. Снимаем устаревшее ограничение на 5 значений.
alter table test_results
  drop constraint if exists test_results_test_type_check;

-- Шаг 2. Страхуемся: если в таблице остались значения, которых нет в
-- справочнике (данные старее migration_011), внешний ключ не создастся.
-- Этот запрос показывает такие строки — при пустом результате шаг 3
-- пройдёт без ошибок.
--
-- select distinct tr.test_type
-- from test_results tr
-- left join test_questionnaires q on q.test_key = tr.test_type
-- where q.test_key is null;

-- Шаг 3. Привязываем test_type к справочнику методик.
-- on delete restrict — нельзя удалить опросник, по которому уже есть
-- результаты клиентов (иначе потеряется расшифровка баллов).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'test_results_test_type_fkey'
  ) then
    alter table test_results
      add constraint test_results_test_type_fkey
      foreign key (test_type)
      references test_questionnaires(test_key)
      on delete restrict;
  end if;
end $$;

-- Проверка: после применения «Отправить как тест клиенту» должно
-- отрабатывать для любой из 22 методик, а не только для пяти старых.
