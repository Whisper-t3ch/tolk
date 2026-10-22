-- Освобождает почту tolkplace@gmail.com для повторной регистрации: старый аккаунт переименовывается (данные остаются).
update auth.users set email = 'tolkplace+old-221022@gmail.com' where email = 'tolkplace@gmail.com';
update auth.identities
   set provider_id = 'tolkplace+old-221022@gmail.com',
       identity_data = jsonb_set(identity_data, '{email}', '"tolkplace+old-221022@gmail.com"')
 where provider = 'email' and identity_data->>'email' = 'tolkplace@gmail.com';
update public.psychologists set email = 'tolkplace+old-221022@gmail.com' where email = 'tolkplace@gmail.com';
select 'переименовано аккаунтов: ' || count(*) as результат from auth.users where email = 'tolkplace+old-221022@gmail.com';
