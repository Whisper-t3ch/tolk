-- Новая партия инвайт-кодов беты: 1 безлимит, 14 платных (400 запросов/мес), 10 пробных (50 запросов, 14 дней). Старые коды не трогаются.
insert into public.invite_codes (code, note, max_uses, plan_name, access_days)
values ('tolk-' || substr(md5(random()::text || clock_timestamp()::text || 'unl2'), 1, 8), 'безлимит (толк)', 1, 'unlimited', null);
insert into public.invite_codes (code, note, max_uses, plan_name, access_days)
select 'tolk-' || substr(md5(random()::text || clock_timestamp()::text || g::text), 1, 8),
       'платный-2 ' || lpad(g::text, 2, '0'), 1, 'beta_paid', null from generate_series(1, 14) g;
insert into public.invite_codes (code, note, max_uses, plan_name, access_days)
select 'tolk-' || substr(md5(random()::text || clock_timestamp()::text || (100 + g)::text), 1, 8),
       'пробный-2 ' || lpad(g::text, 2, '0'), 1, 'beta_free', 14 from generate_series(1, 10) g;
select note || ': ' || code as коды from public.invite_codes where note like '%-2 %' or note = 'безлимит (толк)' order by plan_name, note;
