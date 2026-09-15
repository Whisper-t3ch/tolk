-- ============================================================
-- diagnose_clients_rls.sql — НЕ миграция, просто диагностика.
--
-- migration_027 применилась, но PATCH с deleted_at по-прежнему
-- возвращает 42501 «new row violates row-level security policy».
-- Значит на clients осталась ещё одна политика, которая мешает, и её
-- надо увидеть, а не угадывать.
--
-- Выполнить в Supabase SQL Editor и прислать результат (обе таблицы).
-- Ничего не меняет, только читает.
-- ============================================================

-- 1) Все политики на clients: команда, permissive/restrictive, условия.
--    polcmd: r = SELECT, a = INSERT, w = UPDATE, d = DELETE, * = ALL
--    polpermissive: true = PERMISSIVE (складываются через OR),
--                   false = RESTRICTIVE (складываются через AND —
--                   такая политика может в одиночку заблокировать всё)
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

-- 2) Заодно: есть ли на таблице триггеры или CHECK-ограничения,
--    которые могли бы вмешиваться в запись deleted_at.
select
  conname                    as "ограничение",
  pg_get_constraintdef(oid)  as "определение"
from pg_constraint
where conrelid = 'public.clients'::regclass
  and contype = 'c';
