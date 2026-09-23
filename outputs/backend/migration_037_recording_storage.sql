-- ============================================================
-- migration_037_recording_storage.sql
--
-- Object Storage для фрагментов браузерной записи (Этап 2 архитектуры,
-- см. claude/browser-recording-architecture-spec.md в проекте). Своей
-- ВМ ещё нет, поэтому "Object Storage" из архитектурного документа —
-- это Supabase Storage того же проекта: не нужна отдельная
-- инфраструктура/креды, а при появлении своей ВМ формат ключей
-- (recordings/{session_id}/{track}/{NNNNNN}.{ext}) переносится как есть,
-- меняется только то, куда сложены байты.
--
-- НЕ ПРИМЕНЕНА автоматически — пользователь явно попросил применить
-- лично после ревью (23.09): это новый storage-компонент под реальные
-- аудиозаписи консультаций психолог↔клиент, чувствительные данные, не
-- тестовые справочные ответы. Применять через Supabase SQL Editor.
--
-- ------------------------------------------------------------
-- Логика политик (коротко)
-- ------------------------------------------------------------
-- Бакет 'session-recordings' — приватный (public=false): без политики
-- ниже он вообще никому не отдаёт файлы, даже владельцу. Ownership
-- проверяется не через отдельную таблицу прав на файлы, а тем же
-- способом, что у session_recording_chunks/session_transcript_segments
-- в migration_036: ключ объекта содержит session_id
-- (recordings/{session_id}/{track}/{NNNNNN}.ext), а
-- storage.foldername(name) разбирает путь на сегменты
-- ['recordings', session_id, track] — политика джойнит sessions по
-- этому session_id и сверяет sessions.psychologist_id = auth.uid().
-- То есть право на файл = право на сессию, а не отдельное разрешение
-- на файл. Ни одна политика не даёт доступ к чужим сессиям и не даёт
-- анонимному/service-role пользователю ничего особенного (у
-- service_role есть BYPASSRLS, как и у остальных таблиц проекта — ему
-- политики не нужны, поэтому здесь их нет; служебные операции идут
-- через createAdminClient(), см. src/lib/supabase/admin.ts).
--
--   own_session_recordings_insert (INSERT, роль authenticated) —
--     кто пишет: психолог, которому принадлежит сессия из пути файла.
--     Именно эта политика разрешает браузеру психолога впервые
--     выгрузить фрагмент через API /api/sessions/[id]/recording/chunks.
--
--   own_session_recordings_update (UPDATE, роль authenticated) —
--     кто перезаписывает: тот же психолог. Нужна отдельно от INSERT,
--     потому что повторная выгрузка ОДНОГО И ТОГО ЖЕ фрагмента (retry
--     после обрыва сети, см. src/lib/recording/uploader.ts) идёт как
--     upsert — для Supabase Storage это де-факто update существующего
--     объекта по тому же ключу, а не новый insert. Без этой политики
--     идемпотентный retry падал бы с 403 на втором заходе.
--
--   own_session_recordings_select (SELECT, роль authenticated) —
--     кто читает: тот же психолог. Сейчас файлы не читаются напрямую
--     из браузера (Этап 3 — сборка/ASR — ещё не построен и пойдёт
--     через service role на бэкенде, не через эту политику), но без
--     SELECT-политики бэкенд не смог бы даже подтвердить психологу,
--     что файл действительно долетел, если понадобится точечная
--     проверка не через service role. Клиент (участник консультации)
--     доступа к записям не имеет вообще — ни через одну из политик,
--     на его auth.uid() сравнение с psychologist_id никогда не сойдётся.
--
-- DELETE-политики намеренно нет: удаление записей консультаций — не
-- задача Этапа 2, и её лучше вводить осознанно отдельным шагом (сейчас
-- случайный DELETE от authenticated был бы вообще ничем не заблокирован
-- на уровне Storage RLS, кроме отсутствия самой политики — без неё
-- Postgres по умолчанию запрещает действие).
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'session-recordings',
  'session-recordings',
  false,
  10485760, -- 10 МБ с запасом на фрагмент ~20с аудио (реально десятки-сотни КБ)
  array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'application/octet-stream']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "own_session_recordings_insert" on storage.objects;
create policy "own_session_recordings_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'session-recordings'
    and exists (
      select 1 from sessions s
      where s.id::text = (storage.foldername(name))[2]
        and s.psychologist_id = auth.uid()
    )
  );

drop policy if exists "own_session_recordings_update" on storage.objects;
create policy "own_session_recordings_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'session-recordings'
    and exists (
      select 1 from sessions s
      where s.id::text = (storage.foldername(name))[2]
        and s.psychologist_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'session-recordings'
    and exists (
      select 1 from sessions s
      where s.id::text = (storage.foldername(name))[2]
        and s.psychologist_id = auth.uid()
    )
  );

drop policy if exists "own_session_recordings_select" on storage.objects;
create policy "own_session_recordings_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'session-recordings'
    and exists (
      select 1 from sessions s
      where s.id::text = (storage.foldername(name))[2]
        and s.psychologist_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- Проверки после применения (выполнить вручную):
--
-- select id, public, file_size_limit from storage.buckets where id = 'session-recordings';
--   → public должен быть false.
--
-- select policyname, cmd from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--   and policyname like 'own_session_recordings%';
--   → три политики (insert/update/select).
-- ------------------------------------------------------------
