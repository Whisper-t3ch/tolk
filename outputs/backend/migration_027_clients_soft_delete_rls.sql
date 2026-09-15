-- ============================================================
-- migration_027_clients_soft_delete_rls.sql
--
-- Найдено прогоном-2: кнопка «Удалить клиента» в карточке клиента не
-- работает вообще. PATCH clients с {deleted_at} возвращает
--   403, code 42501: new row violates row-level security policy
--       for table "clients"
-- при том, что обычный PATCH того же клиента (имя, запрос, статус)
-- проходит с 200, а колонка deleted_at в таблице существует и
-- читается.
--
-- Причина: у существующей UPDATE-политики условие «клиент не удалён»
-- стоит не только в USING, но и в WITH CHECK. USING проверяет строку
-- ДО изменения, WITH CHECK — ПОСЛЕ. Поэтому любая попытка проставить
-- deleted_at делает строку не удовлетворяющей WITH CHECK, и Postgres
-- отклоняет ровно то единственное изменение, ради которого колонка
-- заведена. Мягкое удаление было технически невозможно с самого
-- начала — это не проявлялось, потому что UI, вызывающего
-- softDeleteClient(), до недавнего времени просто не было.
--
-- Решение: пересобрать UPDATE-политику так, чтобы
--   USING      — психолог владеет клиентом И клиент ещё не удалён
--                (удалённого трогать нельзя — в том числе нельзя
--                «воскресить» его, обнулив deleted_at из клиента);
--   WITH CHECK — психолог владеет клиентом (без условия на deleted_at,
--                иначе мы снова запретим сам soft-delete).
-- Смена владельца по-прежнему запрещена: psychologist_id проверяется
-- в обеих половинах.
--
-- Имя существующей политики заранее неизвестно (базовая схема
-- создавалась до того, как миграции стали складываться в этот
-- каталог), поэтому старые UPDATE-политики на clients снимаются
-- перебором по pg_policy, а не по угаданному имени.
--
-- SELECT-политику не трогаем: удалённые клиенты остаются читаемыми на
-- уровне БД, а из списков их убирает приложение
-- (fetchClients/fetchClient фильтруют deleted_at is null — добавлено
-- тем же коммитом). Так соблюдается уже принятый в проекте паттерн:
-- executor.ts фильтровал deleted_at и раньше.
--
-- Применять через Supabase SQL Editor. Идемпотентно.
-- ============================================================

alter table clients enable row level security;

-- Снимаем все существующие UPDATE-политики на clients, как бы они ни
-- назывались, — иначе старая (со сломанным WITH CHECK) продолжит
-- действовать параллельно с новой и продолжит отклонять soft-delete:
-- при нескольких PERMISSIVE-политиках WITH CHECK должен пройти хотя бы
-- одну, но у нас старая политика как раз и есть та, что валит запрос.
do $$
declare
  pol record;
begin
  for pol in
    select polname
    from pg_policy
    where polrelid = 'clients'::regclass
      and polcmd = 'w'          -- 'w' = UPDATE
  loop
    execute format('drop policy %I on clients', pol.polname);
  end loop;
end $$;

create policy "clients_update_own"
  on clients
  for update
  to authenticated
  using (
    psychologist_id = auth.uid()
    and deleted_at is null
  )
  with check (
    psychologist_id = auth.uid()
  );

-- Проверка (выполнять не из SQL Editor — там service role в обход RLS,
-- а в приложении): «Клиенты → карточка → Редактировать → Удалить
-- клиента» должна убирать клиента из списка.
--
-- Посмотреть, что политика одна и выглядит как надо:
-- select polname, polcmd,
--        pg_get_expr(polqual, polrelid)      as using_expr,
--        pg_get_expr(polwithcheck, polrelid) as check_expr
-- from pg_policy
-- where polrelid = 'clients'::regclass;
