-- Выполняется под supabase_admin ПОСЛЕ восстановления схемы public из облака.
-- То, что не переносится дампом схемы public (сняты с боевой БД 06.10.2026).

-- 1) Триггер регистрации: при создании пользователя Auth создаётся строка психолога.
--    Функция public.handle_new_user() приезжает вместе со схемой public.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2) Бакет записей сессий (приватный, лимит 10 МБ на файл, как в облаке).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'session-recordings', 'session-recordings', false, 10485760,
  array['audio/webm','audio/mp4','audio/ogg','audio/wav','application/octet-stream']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Политик на storage.objects в облаке нет (storage_policies = 0): доступ идёт через service_role.
