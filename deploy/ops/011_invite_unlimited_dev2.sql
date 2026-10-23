-- Инвайт-код без ограничений для второго разработчика (1 использование).
insert into public.invite_codes (code, note, max_uses, plan_name, access_days)
values ('tolk-043aca29', 'безлимит (разработчик 2)', 1, 'unlimited', null)
on conflict (code) do nothing;
select note || ': ' || code as коды from public.invite_codes where code = 'tolk-043aca29';
