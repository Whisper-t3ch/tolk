-- ============================================================
-- migration_015_knowledge_base_questionnaire_key_batch2.sql
--
-- Продолжение migration_013: проставляет knowledge_base.questionnaire_key
-- для 11 методик, перенесённых в migration_014_seed_test_questionnaires_batch2.sql
-- (второй раунд наполнения test_questionnaires) — теперь "Отправить
-- клиенту" на вкладке "Тесты" для этих методик тоже создаёт настоящий
-- интерактивный тест со ссылкой, а не пересылает текст описания.
--
-- Применять через Supabase SQL Editor, ПОСЛЕ migration_013 и
-- migration_014. Все операции идемпотентны — безопасно применять
-- повторно.
-- ============================================================

update knowledge_base set questionnaire_key = 'LAZARUS_FOLKMAN' where source_type = 'test' and title = 'Опросник способов совладающего поведения (Лазарус-Фолкман, адаптация Крюковой-Куфтяк-Замышляевой)';
update knowledge_base set questionnaire_key = 'BOYKO_BURNOUT' where source_type = 'test' and title = 'Опросник эмоционального выгорания (В.В. Бойко)';
update knowledge_base set questionnaire_key = 'STOLIN_MIS' where source_type = 'test' and title = 'Методика исследования самоотношения (МИС, Столин-Пантилеев)';
update knowledge_base set questionnaire_key = 'BUSS_PERRY' where source_type = 'test' and title = 'Опросник агрессивности Басса-Перри (адаптированный вариант)';
update knowledge_base set questionnaire_key = 'MARITAL_SATISFACTION' where source_type = 'test' and title = 'Тест-опросник удовлетворённости браком (В.В. Столин, Т.Л. Романова, Г.П. Бутенко)';
update knowledge_base set questionnaire_key = 'BOYKO_EMPATHY' where source_type = 'test' and title = 'Диагностика уровня эмпатии (В.В. Бойко)';
update knowledge_base set questionnaire_key = 'PRIKHOZHAN' where source_type = 'test' and title = 'Шкала тревожности Спилбергера для детей и подростков (адаптация А.М. Прихожан)';
update knowledge_base set questionnaire_key = 'TAS26' where source_type = 'test' and title = 'Торонтская алекситимическая шкала (адаптация НИПНИ им. В.М. Бехтерева)';
update knowledge_base set questionnaire_key = 'ROKICH' where source_type = 'test' and title = 'Методика ценностных ориентаций (М. Рокич, в отечественных адаптациях) — бланк';
update knowledge_base set questionnaire_key = 'LEARY' where source_type = 'test' and title = 'Методика диагностики межличностных отношений (Т. Лири) — назначение и структура';
update knowledge_base set questionnaire_key = 'SAN' where source_type = 'test' and title = 'Опросник САН (Самочувствие-Активность-Настроение) — бланк и обработка';
