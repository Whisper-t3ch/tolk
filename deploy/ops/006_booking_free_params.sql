-- Параметры записи теперь произвольные числа (длительность, буфер, уведомление, дней вперёд): снимаем возможные CHECK-ограничения
-- на эти колонки (в репозитории их определения не нашлось, на проде они могли быть заданы под фиксированные значения).
do $$
declare c record; n int := 0;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.booking_settings'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ~ '(session_duration_minutes|buffer_minutes|min_notice_hours|max_advance_days)'
  loop
    execute format('alter table public.booking_settings drop constraint %I', c.conname);
    n := n + 1;
  end loop;
  raise notice 'снято CHECK-ограничений: %', n;
end $$;
select 'booking params: ok' as result;
