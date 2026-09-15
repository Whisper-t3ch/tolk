-- ============================================================
-- migration_028_soft_delete_client_rpc.sql
--
-- Настоящая причина того, что «Удалить клиента» отбивалось 42501
-- (migration_027 мимо — её можно не применять, она безвредна, но
-- проблему не решает).
--
-- Диагностика прямыми запросами от имени психолога:
--   PATCH {request: "..."}      -> 204   обычное поле пишется
--   PATCH {deleted_at: <дата>}  -> 403   42501
--   PATCH {deleted_at: null}    -> 204   NULL пишется
-- То есть отвергается не операция UPDATE, а конкретно строка, у
-- которой deleted_at перестал быть NULL.
--
-- Политики на clients:
--   clients_update_own  UPDATE  using (auth.uid() = psychologist_id),
--                               with_check = null
--   clients_select_own  SELECT  using (auth.uid() = psychologist_id
--                                      AND deleted_at IS NULL)
--
-- У UPDATE-политики WITH CHECK не задан, поэтому проверкой новой
-- строки служит её USING — а он про deleted_at ничего не знает и
-- пропустил бы запись. Мешает SELECT-политика: PostgREST выполняет
-- UPDATE ... RETURNING (даже при Prefer: return=minimal, чтобы
-- сосчитать затронутые строки), а после проставления deleted_at
-- строка перестаёт удовлетворять SELECT-политике и становится
-- невидимой. Обновление, результат которого нельзя прочитать,
-- отвергается целиком.
--
-- Мягкое удаление через PostgREST в такой схеме невозможно в
-- принципе — и это, по сути, правильная схема: условие deleted_at IS
-- NULL в SELECT-политике гарантирует, что удалённый клиент не
-- всплывёт ни в одном запросе, даже если в приложении забудут фильтр.
-- Ослаблять её ради удаления — значит менять гарантию БД на
-- дисциплину в коде, на данных психотерапии это плохой размен.
--
-- Поэтому удаление выносится в функцию с SECURITY DEFINER: она
-- выполняется с правами владельца таблицы и не подчиняется RLS, но
-- принадлежность клиента проверяет сама, явно и жёстко. Снаружи
-- функция не даёт ничего сверх того, что психолог и так может делать
-- со своими клиентами.
--
-- Применять через Supabase SQL Editor. Идемпотентно.
-- ============================================================

create or replace function public.soft_delete_client(p_client_id uuid)
returns void
language plpgsql
security definer
-- Фиксируем search_path: без этого вызывающий может подсунуть свою
-- схему с таблицей clients, и функция с правами владельца отработает
-- по ней.
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Не авторизован' using errcode = '28000';
  end if;

  update public.clients
     set deleted_at = now()
   where id = p_client_id
     and psychologist_id = v_caller
     and deleted_at is null;

  -- Ни одной строки — либо клиента нет, либо он чужой, либо уже
  -- удалён. Намеренно не различаем эти случаи в тексте: иначе по
  -- ответу можно было бы проверять существование чужих записей.
  if not found then
    raise exception 'Клиент не найден' using errcode = 'P0002';
  end if;
end;
$$;

-- Функция с SECURITY DEFINER доступна всем ролям по умолчанию —
-- убираем и выдаём точечно.
revoke all on function public.soft_delete_client(uuid) from public;
revoke all on function public.soft_delete_client(uuid) from anon;
grant execute on function public.soft_delete_client(uuid) to authenticated;

-- Проверка — в приложении: «Клиенты → карточка → Редактировать →
-- Удалить клиента» должна убирать клиента из списка.
--
-- Убедиться, что функция создана с нужными правами:
-- select proname, prosecdef, proconfig
-- from pg_proc where proname = 'soft_delete_client';
