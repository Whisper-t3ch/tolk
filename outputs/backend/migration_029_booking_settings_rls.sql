-- ============================================================
-- migration_029_booking_settings_rls.sql
--
-- Найдено при диагностике прогона-2: SELECT к booking_settings от
-- имени психолога возвращает строки ВСЕХ психологов. Проверка от
-- реального пользователя:
--   booking_settings -> rows=2, distinctOwners=2, foreign=1
-- тогда как clients, sessions, messages, soap_notes, test_results,
-- period_summaries, agent_sessions и остальные таблицы в том же
-- прогоне отдали строки только своего владельца.
--
-- Персональных данных клиентов в booking_settings нет, но наружу
-- утекают рабочие часы, длительность сессии, буфер, минимальное
-- уведомление и — главное — public_slug чужого психолога, то есть
-- прямая ссылка на его страницу записи. Перед бетой это чинится.
--
-- Публичная страница бронирования не пострадает: /api/public/booking/*
-- ходит через createAdminClient() (service role) и RLS не подчиняется —
-- см. комментарий в slots/route.ts. Кабинет психолога читает свои
-- настройки от своего имени и продолжит их видеть.
--
-- Имена существующих политик заранее неизвестны, поэтому старые
-- снимаются перебором по pg_policy — как в migration_027, но здесь
-- для ВСЕХ команд (polcmd любой), а не только UPDATE: именно на этом
-- migration_027 и споткнулась, оставив политику FOR ALL незамеченной.
--
-- Применять через Supabase SQL Editor. Идемпотентно.
-- ============================================================

alter table booking_settings enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select polname
    from pg_policy
    where polrelid = 'public.booking_settings'::regclass
  loop
    execute format('drop policy %I on public.booking_settings', pol.polname);
  end loop;
end $$;

-- Психолог видит и меняет только свою строку. Отдельные политики на
-- команду вместо одной FOR ALL — так в pg_policy сразу видно, что
-- именно разрешено, и не повторяется история с политикой, которую не
-- заметили при диагностике.
create policy "booking_settings_select_own"
  on booking_settings
  for select
  to authenticated
  using (psychologist_id = auth.uid());

create policy "booking_settings_insert_own"
  on booking_settings
  for insert
  to authenticated
  with check (psychologist_id = auth.uid());

create policy "booking_settings_update_own"
  on booking_settings
  for update
  to authenticated
  using (psychologist_id = auth.uid())
  with check (psychologist_id = auth.uid());

create policy "booking_settings_delete_own"
  on booking_settings
  for delete
  to authenticated
  using (psychologist_id = auth.uid());

-- Проверка — в приложении: «Настройки → Публичная запись» должна
-- по-прежнему открываться и сохраняться, а публичная страница
-- /book/<slug> — отдавать слоты (она ходит через service role).
--
-- Убедиться, что политик ровно четыре и все по владельцу:
-- select polname, polcmd,
--        pg_get_expr(polqual, polrelid)      as using_expr,
--        pg_get_expr(polwithcheck, polrelid) as check_expr
-- from pg_policy
-- where polrelid = 'public.booking_settings'::regclass;
