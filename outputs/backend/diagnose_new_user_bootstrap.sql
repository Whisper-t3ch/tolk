-- ============================================================
-- diagnose_new_user_bootstrap.sql — НЕ миграция, только чтение (шаг 2).
--
-- Триггер on_auth_user_created нашёлся, блокер снят: строка
-- psychologists создаётся. Но вставляет он только id и email:
--
--   insert into public.psychologists (id, email) values (new.id, new.email);
--
-- Значит всё остальное должно приходить из DEFAULT колонок. Код читает
-- plan_name, assistant_requests_used, assistant_requests_reset_at,
-- timezone, specialty, approach, typical_client_request,
-- onboarding_completed_at. Критичны первые три: resolvePlanLimit при
-- пустом plan_name честно падает в beta (200 запросов), а вот
-- assistant_requests_used = NULL превратится в 0 только потому, что в
-- коде стоит ?? 0 — если же DEFAULT не задан и колонка NOT NULL, упадёт
-- сама вставка триггера, то есть регистрация.
--
-- Проверяем дефолты и nullable по всем колонкам psychologists.
-- Один запрос — SQL Editor покажет именно его результат.
-- ============================================================

select
  column_name                          as "колонка",
  data_type                            as "тип",
  is_nullable                          as "nullable",
  column_default                       as "default"
from information_schema.columns
where table_schema = 'public'
  and table_name = 'psychologists'
order by ordinal_position;

-- На что смотреть:
--   • plan_name — нужен DEFAULT 'beta' (иначе новый психолог получит
--     лимит по умолчанию из кода, но в UI тариф покажется пустым);
--   • assistant_requests_used — DEFAULT 0;
--   • assistant_requests_reset_at — DEFAULT (начало следующего месяца)
--     или NULL (тогда resetIfDue просто не сбросит счётчик — не
--     страшно);
--   • timezone — DEFAULT 'Europe/Moscow' желателен, иначе у психолога
--     из другого пояса расписание поедет до первого захода в настройки;
--   • любая NOT NULL колонка без DEFAULT, кроме id и email, — это
--     сломанная регистрация: триггер не сможет вставить строку.
