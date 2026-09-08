-- ============================================================
-- migration_013_knowledge_base_questionnaire_key.sql
--
-- Связывает записи knowledge_base (source_type='test') с реальными
-- интерактивными опросниками из test_questionnaires (см.
-- migration_011/012) — теперь "Отправить клиенту" на вкладке "Тесты"
-- может создавать настоящий тест с вопросами и автоподсчётом (через
-- test_results.access_token), а не просто пересылать текст описания
-- методики.
--
-- Применять через Supabase SQL Editor. Все операции идемпотентны —
-- безопасно применять повторно.
-- ============================================================

alter table knowledge_base
  add column if not exists questionnaire_key text;

comment on column knowledge_base.questionnaire_key is
  'Ссылка на test_questionnaires.test_key — если заполнено, у этого материала (source_type=test) есть реальный интерактивный опросник, который можно отправить клиенту по ссылке вместо текста описания методики. NULL, если для этой методики пока нет интерактивной формы.';

-- Проставляем questionnaire_key существующим записям в knowledge_base
-- по заголовку — соответствует полю questionnaireKey, добавленному в
-- src/lib/approaches.ts для тех же материалов. Если у психолога эти
-- записи уже засеяны под старым заголовком (до переименований в
-- предыдущих миграциях), апдейт просто не найдёт совпадений — не
-- страшно, значение проставится при следующем ре-сиде.
update knowledge_base set questionnaire_key = 'STAI' where source_type = 'test' and title = 'Шкала тревоги Спилбергера-Ханина — бланк и обработка';
update knowledge_base set questionnaire_key = 'SZHO' where source_type = 'test' and title = 'Тест смысложизненных ориентаций (СЖО, Д.А. Леонтьев)';
update knowledge_base set questionnaire_key = 'ROSENBERG' where source_type = 'test' and title = 'Шкала самоуважения Розенберга';
update knowledge_base set questionnaire_key = 'ZUNG' where source_type = 'test' and title = 'Шкала депрессии Цунга (адаптация Т.И. Балашовой)';
update knowledge_base set questionnaire_key = 'GSES' where source_type = 'test' and title = 'Шкала общей самоэффективности (Р. Шварцер, М. Ерусалем, адаптация В. Ромека)';
update knowledge_base set questionnaire_key = 'PSS10' where source_type = 'test' and title = 'Шкала воспринимаемого стресса (PSS-10, адаптация)';
