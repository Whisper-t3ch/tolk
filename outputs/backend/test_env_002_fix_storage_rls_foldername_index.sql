-- ============================================================
-- test_env_002_fix_storage_rls_foldername_index.sql
--
-- ТОЛЬКО для изолированного тестового Supabase-проекта
-- (jjwfmcxiogcjunuoziau, "tolk-test-recording"). Production
-- (gprmbaiacvchtovzpeqa) НЕ применять этой миграцией — там путь
-- объекта Storage ещё старый (migration_038 на прод не применена),
-- эти политики там пока корректны для СТАРОЙ структуры пути. Когда
-- (и если) migration_038 будет применена к проду, эту же правку
-- нужно будет применить и там — стоит держать в виду при подготовке
-- прод-миграции.
--
-- ПРИЧИНА (обнаружено 25.09.2026 живым тестом — каждый confirm
-- фрагмента получал 409 "файл не найден в хранилище", хотя файл
-- реально лежал в Storage, что подтверждено прямым SELECT из
-- storage.objects):
--
-- confirm-route (/api/sessions/[id]/recording/chunks) проверяет
-- наличие объекта через storage.list() ОБЫЧНЫМ (не service-role)
-- клиентом психолога — то есть под RLS. Политики
-- own_session_recordings_{insert,select,update} на storage.objects
-- (скопированы из migration_037_recording_storage.sql, применённой
-- на проде 23.09) сравнивают
--   (storage.foldername(objects.name))[2] = session_id
-- Это было верно для СТАРОЙ структуры пути ИЗ migration_037:
--   recordings/{session_id}/{track}/{NNNNNN}.ext
-- (см. заголовок migration_037.sql: "ключ объекта содержит session_id
-- (recordings/{session_id}/{track}/{NNNNNN}.ext)") — с ведущим
-- сегментом "recordings", поэтому foldername(name) = ['recordings',
-- session_id, track], и session_id действительно был на позиции [2].
--
-- После migration_038 путь стал:
--   {session_id}/{recording_attempt_id}/{track}/{NNNNNN}.ext
-- — БЕЗ ведущего "recordings/" и С добавленным attempt_id (см.
-- storageKey в chunks/authorize/route.ts и chunks/route.ts). Теперь
-- [1] = session_id, [2] = recording_attempt_id, [3] = track.
-- Политика по-прежнему сравнивает [2] с session_id — то есть
-- фактически сравнивает СЛУЧАЙНЫЙ attempt_id (UUID) с session_id,
-- что никогда не совпадает. INSERT/UPDATE эту проверку на практике
-- обходят (подписанный upload-токен не проверяется через RLS — см.
-- комментарий в chunks/authorize/route.ts), поэтому сама загрузка
-- в Storage работала. Но SELECT (list() в confirm) — единственное
-- место, где путь реально проверяется под RLS обычным клиентом, —
-- всегда возвращал пусто → "файл не найден" → 409 на КАЖДОМ
-- фрагменте, без исключений.
--
-- ИСПРАВЛЕНИЕ: [2] → [1] в проверке session_id во всех трёх
-- политиках. Больше НИЧЕГО не меняется — bucket_id-проверка,
-- владение через public.sessions.psychologist_id = auth.uid(),
-- роль (authenticated), команды (insert/select/update) — всё как
-- было, один и тот же индекс исправлен в трёх местах.
-- ============================================================

drop policy if exists "own_session_recordings_insert" on storage.objects;
create policy "own_session_recordings_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'session-recordings'
    and exists (
      select 1 from public.sessions s
      where s.id::text = (storage.foldername(objects.name))[1]
        and s.psychologist_id = auth.uid()
    )
  );

drop policy if exists "own_session_recordings_select" on storage.objects;
create policy "own_session_recordings_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'session-recordings'
    and exists (
      select 1 from public.sessions s
      where s.id::text = (storage.foldername(objects.name))[1]
        and s.psychologist_id = auth.uid()
    )
  );

drop policy if exists "own_session_recordings_update" on storage.objects;
create policy "own_session_recordings_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'session-recordings'
    and exists (
      select 1 from public.sessions s
      where s.id::text = (storage.foldername(objects.name))[1]
        and s.psychologist_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'session-recordings'
    and exists (
      select 1 from public.sessions s
      where s.id::text = (storage.foldername(objects.name))[1]
        and s.psychologist_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- Проверка после применения (выполнить вручную):
--
-- select policyname, cmd, qual, with_check from pg_policies
--   where schemaname='storage' and tablename='objects'
--   order by policyname;
--   → все три qual/with_check должны содержать
--     "(storage.foldername(objects.name))[1]", не [2].
-- ------------------------------------------------------------
