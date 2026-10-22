-- Функции для кнопки «Удалить аккаунт» (Настройки → Опасные действия): каскадное удаление всех данных психолога.
-- Вызывает только серверный код с service role (/api/profile/delete) после проверки пароля. Файлы записей из хранилища удаляет сам роут.
create or replace function public._purge_rows(rel regclass, col name, val uuid) returns void
language plpgsql security definer set search_path = public, auth as $f$
declare f record; ids uuid[];
begin
  for f in
    select c.conrelid::regclass as t, ca.attname as ccol, ra.attname as rcol
      from pg_constraint c
      join pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = c.conkey[1]
      join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
     where c.contype = 'f' and c.confrelid = rel and array_length(c.conkey, 1) = 1
       and c.confdeltype not in ('c', 'n')
  loop
    execute format('select coalesce(array_agg(%I), ''{}'') from %s where %I = $1', f.rcol, rel, col) into ids using val;
    if array_length(ids, 1) > 0 then
      perform public._purge_rows(f.t, f.ccol, i) from unnest(ids) as i;
    end if;
  end loop;
  execute format('delete from %s where %I = $1', rel, col) using val;
end $f$;

create or replace function public.delete_account(p_uid uuid) returns void
language plpgsql security definer set search_path = public, auth as $f$
begin
  if p_uid is null or not exists (select 1 from auth.users where id = p_uid) then
    raise exception 'user not found';
  end if;
  perform public._purge_rows('auth.users'::regclass, 'id', p_uid);
end $f$;

revoke all on function public._purge_rows(regclass, name, uuid) from public, anon, authenticated;
revoke all on function public.delete_account(uuid) from public, anon, authenticated;
grant execute on function public._purge_rows(regclass, name, uuid) to service_role;
grant execute on function public.delete_account(uuid) to service_role;
notify pgrst, 'reload schema';
select 'функции удаления аккаунта созданы' as результат;
