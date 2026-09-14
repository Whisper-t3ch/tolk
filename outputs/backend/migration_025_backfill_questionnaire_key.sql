-- ============================================================
-- migration_025_backfill_questionnaire_key.sql
--
-- Продолжение migration_024. Методики психологам дозалились, но кнопка
-- «Отправить как тест клиенту» всё равно не появилась: у записей пустой
-- questionnaire_key, а без него карточка не считается интерактивным
-- опросником — ни бейджа, ни кнопки, назначить клиенту нельзя.
--
-- Причина: ключ есть в seed-данных (questionnaireKey в
-- src/lib/approaches.ts), но код онбординга его не переносил — вставлял
-- только title/content/embedding/source_type/approach. Поле терялось, и
-- тесты оседали в базе знаний как обычные текстовые материалы.
--
-- Код онбординга исправлен. Эта миграция проставляет ключ записям,
-- созданным до исправления — сопоставление по точному заголовку из тех
-- же seed-данных.
--
-- Применять через Supabase SQL Editor. Идемпотентно.
-- ============================================================

update knowledge_base set questionnaire_key = 'LEARY'
  where source_type = 'test' and questionnaire_key is null and title = 'Методика диагностики межличностных отношений (Т. Лири) — назначение и структура';

update knowledge_base set questionnaire_key = 'SAN'
  where source_type = 'test' and questionnaire_key is null and title = 'Опросник САН (Самочувствие-Активность-Настроение) — бланк и обработка';

update knowledge_base set questionnaire_key = 'ROKICH'
  where source_type = 'test' and questionnaire_key is null and title = 'Методика ценностных ориентаций (М. Рокич, в отечественных адаптациях) — бланк';

update knowledge_base set questionnaire_key = 'STAI'
  where source_type = 'test' and questionnaire_key is null and title = 'Шкала тревоги Спилбергера-Ханина — бланк и обработка';

update knowledge_base set questionnaire_key = 'SZHO'
  where source_type = 'test' and questionnaire_key is null and title = 'Тест смысложизненных ориентаций (СЖО, Д.А. Леонтьев)';

update knowledge_base set questionnaire_key = 'LAZARUS_FOLKMAN'
  where source_type = 'test' and questionnaire_key is null and title = 'Опросник способов совладающего поведения (Лазарус-Фолкман, адаптация Крюковой-Куфтяк-Замышляевой)';

update knowledge_base set questionnaire_key = 'ROSENBERG'
  where source_type = 'test' and questionnaire_key is null and title = 'Шкала самоуважения Розенберга';

update knowledge_base set questionnaire_key = 'BOYKO_BURNOUT'
  where source_type = 'test' and questionnaire_key is null and title = 'Опросник эмоционального выгорания (В.В. Бойко)';

update knowledge_base set questionnaire_key = 'STOLIN_MIS'
  where source_type = 'test' and questionnaire_key is null and title = 'Методика исследования самоотношения (МИС, Столин-Пантилеев)';

update knowledge_base set questionnaire_key = 'BUSS_PERRY'
  where source_type = 'test' and questionnaire_key is null and title = 'Опросник агрессивности Басса-Перри (адаптированный вариант)';

update knowledge_base set questionnaire_key = 'TAS26'
  where source_type = 'test' and questionnaire_key is null and title = 'Торонтская алекситимическая шкала (адаптация НИПНИ им. В.М. Бехтерева)';

update knowledge_base set questionnaire_key = 'ZUNG'
  where source_type = 'test' and questionnaire_key is null and title = 'Шкала депрессии Цунга (адаптация Т.И. Балашовой)';

update knowledge_base set questionnaire_key = 'MARITAL_SATISFACTION'
  where source_type = 'test' and questionnaire_key is null and title = 'Тест-опросник удовлетворённости браком (В.В. Столин, Т.Л. Романова, Г.П. Бутенко)';

update knowledge_base set questionnaire_key = 'GSES'
  where source_type = 'test' and questionnaire_key is null and title = 'Шкала общей самоэффективности (Р. Шварцер, М. Ерусалем, адаптация В. Ромека)';

update knowledge_base set questionnaire_key = 'PSS10'
  where source_type = 'test' and questionnaire_key is null and title = 'Шкала воспринимаемого стресса (PSS-10, адаптация)';

update knowledge_base set questionnaire_key = 'BOYKO_EMPATHY'
  where source_type = 'test' and questionnaire_key is null and title = 'Диагностика уровня эмпатии (В.В. Бойко)';

update knowledge_base set questionnaire_key = 'PRIKHOZHAN'
  where source_type = 'test' and questionnaire_key is null and title = 'Шкала тревожности Спилбергера для детей и подростков (адаптация А.М. Прихожан)';

-- Проверка: не должно остаться тестов без ключа.
-- select title from knowledge_base
-- where source_type = 'test' and questionnaire_key is null;
