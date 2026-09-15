-- ============================================================
-- diagnose_clients_rls.sql — НЕ миграция, только чтение.
--
-- CHECK-ограничения уже посмотрели: на clients их два (gender и
-- status), к deleted_at отношения не имеют — значит 42501 приходит
-- именно от RLS, и нужно увидеть политики.
--
-- Здесь один запрос, чтобы SQL Editor показал именно его результат
-- (при нескольких запросов подряд он выводит только последний).
--
-- Выполнить в Supabase SQL Editor и прислать таблицу целиком.
-- ============================================================

select
  polname                                  as "политика",
  case polcmd
    when 'r' then 'SELECT'
    when 'a' then 'INSERT'
    when 'w' then 'UPDATE'
    when 'd' then 'DELETE'
    when '*' then 'ALL'
  end                                      as "команда",
  case when polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end as "тип",
  pg_get_expr(polqual, polrelid)           as "using",
  pg_get_expr(polwithcheck, polrelid)      as "with_check"
from pg_policy
where polrelid = 'public.clients'::regclass
order by polcmd, polname;

-- Что ищем:
--   • строку с типом RESTRICTIVE — такие складываются через AND, и одна
--     такая политика блокирует запись, сколько бы разрешающих ни было;
--   • политику с командой ALL — migration_027 снимала только UPDATE
--     (polcmd = 'w'), поэтому FOR ALL могла уцелеть;
--   • любое упоминание deleted_at в колонке with_check — именно оно и
--     запрещает проставить дату удаления.
