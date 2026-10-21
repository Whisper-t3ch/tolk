-- Выдача кодов беты (запускать ОДИН раз после migration_052): 14 платных + 10 пробных + 1 безлимитный.
-- Коды случайные, формата tolk-xxxxxxxx. В конце — список для рассылки.
-- Запуск: sudo docker exec -i supabase-db psql -U supabase_admin -d postgres < issue_beta_invite_codes.sql

insert into public.invite_codes (code, note, max_uses, plan_name, access_days)
select 'tolk-' || substr(md5(random()::text || clock_timestamp()::text || g::text), 1, 8),
       'платный ' || lpad(g::text, 2, '0'), 1, 'beta_paid', null
  from generate_series(1, 14) g;

insert into public.invite_codes (code, note, max_uses, plan_name, access_days)
select 'tolk-' || substr(md5(random()::text || clock_timestamp()::text || (100 + g)::text), 1, 8),
       'пробный ' || lpad(g::text, 2, '0'), 1, 'beta_free', 14
  from generate_series(1, 10) g;

insert into public.invite_codes (code, note, max_uses, plan_name, access_days)
values ('tolk-' || substr(md5(random()::text || clock_timestamp()::text || 'brother'), 1, 8),
        'брат (безлимит)', 1, 'unlimited', null);

select note, code, plan_name, coalesce(access_days::text || ' дн.', 'без срока') as срок
  from public.invite_codes
 where plan_name <> 'beta'
 order by plan_name, note;
