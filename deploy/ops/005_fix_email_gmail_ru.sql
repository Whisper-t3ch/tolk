-- Тестер зарегистрировался с опечаткой в домене (2970371@gmail.ru), а входит и сбрасывает пароль по 2970371@gmail.com.
-- Переименовываем аккаунт на правильный адрес; пароль и все данные остаются прежними.
do $$
declare uid uuid;
begin
  select id into uid from auth.users where lower(email) = '2970371@gmail.ru';
  if uid is null then raise exception 'аккаунт 2970371@gmail.ru не найден'; end if;
  if exists (select 1 from auth.users where lower(email) = '2970371@gmail.com') then
    raise exception 'адрес 2970371@gmail.com уже занят';
  end if;
  update auth.users set email = '2970371@gmail.com', email_confirmed_at = coalesce(email_confirmed_at, now()),
         raw_user_meta_data = jsonb_set(coalesce(raw_user_meta_data, '{}'::jsonb), '{email}', '"2970371@gmail.com"'), updated_at = now()
   where id = uid;
  update auth.identities set identity_data = jsonb_set(identity_data, '{email}', '"2970371@gmail.com"'), updated_at = now()
   where user_id = uid and provider = 'email';
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'psychologists' and column_name = 'email') then
    update public.psychologists set email = '2970371@gmail.com' where id = uid;
  end if;
end $$;
select u.email, p.plan_name, p.access_expires_at from auth.users u left join public.psychologists p on p.id = u.id where u.email = '2970371@gmail.com';
