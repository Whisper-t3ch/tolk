-- ============================================================
-- migration_038_recording_attempt_id.sql
--
-- Добавлено 24.09.2026 по прямому требованию пользователя (ветка
-- recording-signed-upload-24-09, ещё не в main) — закрывает КОНКРЕТНУЮ
-- проблему, которую предыдущая идемпотентная проверка на confirm
-- (409 при несовпадении checksum) НЕ закрывала:
--
--   409 в confirm-route защищает СТРОКУ В БД (не даёт молча подменить
--   уже подтверждённые метаданные), но НЕ защищает БАЙТЫ В STORAGE.
--   К моменту confirm-проверки Blob нового фрагмента уже физически
--   мог лежать в Storage поверх старого — потому что путь объекта
--   был построен только из (session_id, track, sequence), а этот же
--   путь выдавался заново при каждой перезагрузке вкладки (сквозная
--   нумерация внутри дорожки начиналась с нуля для того же session_id,
--   см. известное ограничение в chunkStore.ts).
--
-- Решение: путь физического объекта больше не совпадает с логическим
-- ключом (track, sequence). Каждый "заход" записи (создание
-- ChunkUploader в JitsiCallView — т.е. один раз за монтирование
-- компонента/перезагрузку страницы) получает СЕРВЕРНЫЙ
-- recording_attempt_id (клиент не может его подделать или задать
-- сам — см. .../recording/attempts/route.ts). Путь объекта в Storage:
--   {session_id}/{recording_attempt_id}/{track}/{sequence}.{ext}
-- Уникальность в БД теперь на (recording_attempt_id, track, sequence),
-- а не на (session_id, track, sequence). Перезагрузка вкладки = новая
-- попытка = новый attempt_id = новый префикс пути = СТРУКТУРНО не
-- может задеть байты предыдущей попытки, а не просто "не должна" по
-- соглашению кода.
--
-- НЕ ПРИМЕНЕНО К ПРОД-БД — подготовлено, ждёт вашего разрешения (тот
-- же протокол, что и для предыдущих миграций). session_recording_chunks
-- подтверждённо пустая на момент подготовки (0 строк, проверено
-- 24.09 напрямую через mcp__Supabase__execute_sql) — NOT NULL на новом
-- столбце ниже добавляется без бэкфилла, риск для существующих данных
-- нулевой. Если к моменту применения в таблице УЖЕ есть строки
-- (например, кто-то успел провести тест до применения этой миграции) —
-- ЭТУ миграцию до её применения нужно пересмотреть: NOT NULL без
-- бэкфилла тогда упадёт, и это правильно — лучше явная ошибка
-- применения, чем молчаливая порча существующих записей.
--
-- ВАЖНО: применять ЭТУ миграцию ДО migration_039 (переименованный
-- checksum_verified, см. его новый заголовок) — checksum_verified
-- логически зависит от того, что схема путей уже устоялась, чтобы не
-- накладывать две несогласованные миграции подряд (по вашей просьбе,
-- п.4).
-- ============================================================

-- ------------------------------------------------------------
-- Таблица попыток записи. Одна строка = один непрерывный "заход"
-- SessionRecorder в браузере психолога (от создания ChunkUploader до
-- остановки/перезагрузки/закрытия вкладки). Обе дорожки (psychologist
-- и client) одной попытки используют один и тот же attempt_id — это
-- один SessionRecorder на обе дорожки, не отдельный объект на трек.
-- ------------------------------------------------------------
create table if not exists public.recording_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  -- 'active' — текущая попытка (последняя созданная для сессии, ещё не
  --   вытеснена более новой). 'superseded' — вытеснена новой попыткой
  --   той же сессии (психолог перезагрузил вкладку); её confirmed-чанки
  --   остаются валидными данными, просто это больше не "текущий" заход.
  --   'completed' — сейчас НЕ проставляется автоматически ни одним
  --   route (нет события "успешно досняли до конца" на уровне
  --   попытки, есть только recording_status на sessions) — зарезервировано
  --   на будущее, если понадобится различать "вытеснена перезагрузкой"
  --   и "штатно завершена". Это осознанно НЕ решено сейчас — открытый
  --   вопрос см. в architecture-spec.
  status text not null default 'active' check (status in ('active', 'superseded', 'completed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists recording_attempts_session_idx on public.recording_attempts(session_id);

alter table public.recording_attempts enable row level security;

drop policy if exists "own_recording_attempts_insert" on public.recording_attempts;
create policy "own_recording_attempts_insert" on public.recording_attempts
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (select 1 from public.sessions s where s.id = session_id and s.psychologist_id = auth.uid())
  );

drop policy if exists "own_recording_attempts_select" on public.recording_attempts;
create policy "own_recording_attempts_select" on public.recording_attempts
  for select to authenticated
  using (
    exists (select 1 from public.sessions s where s.id = session_id and s.psychologist_id = auth.uid())
  );

drop policy if exists "own_recording_attempts_update" on public.recording_attempts;
create policy "own_recording_attempts_update" on public.recording_attempts
  for update to authenticated
  using (
    exists (select 1 from public.sessions s where s.id = session_id and s.psychologist_id = auth.uid())
  )
  with check (
    exists (select 1 from public.sessions s where s.id = session_id and s.psychologist_id = auth.uid())
  );

-- Намеренно нет DELETE-политики — как и у session_recording_chunks/
-- storage.objects, удаление попыток не задача этого шага.

-- ------------------------------------------------------------
-- session_recording_chunks: логический номер (track, sequence)
-- остаётся, но перестаёт быть частью пути объекта и частью уникального
-- ключа. Уникальность переносится на (recording_attempt_id, track,
-- sequence) — то есть "внутри одной попытки записи один и тот же
-- номер фрагмента дорожки встречается не более одного раза", что и
-- является настоящим инвариантом (а не "во всей консультации", что
-- было неверно уже на уровне логики, не только Storage — см. известное
-- ограничение chunkStore.ts про сквозную нумерацию, из-за которого и
-- была нужна прежняя checksum-проверка на confirm).
-- ------------------------------------------------------------
alter table public.session_recording_chunks
  add column if not exists recording_attempt_id uuid references public.recording_attempts(id);

-- Таблица пуста (подтверждено 24.09) — NOT NULL без бэкфилла безопасен.
alter table public.session_recording_chunks
  alter column recording_attempt_id set not null;

alter table public.session_recording_chunks
  drop constraint if exists session_recording_chunks_session_id_track_sequence_key;

alter table public.session_recording_chunks
  add constraint session_recording_chunks_attempt_track_sequence_key
  unique (recording_attempt_id, track, sequence);

comment on column public.session_recording_chunks.recording_attempt_id is
  'Ссылка на конкретный "заход" записи (recording_attempts). Уникальность фрагмента — (recording_attempt_id, track, sequence), не (session_id, track, sequence): перезагрузка вкладки начинает новую попытку с новым attempt_id, поэтому нумерация "с нуля" в новой попытке никогда не коллизирует со старой. storage_key при этом содержит {session_id}/{recording_attempt_id}/{track}/{sequence}.{ext} — путь физического объекта тоже уникален по попытке, не только логический ключ в БД.';

-- ------------------------------------------------------------
-- Проверки после применения (выполнить вручную):
--
-- select table_name from information_schema.tables
--   where table_schema='public' and table_name='recording_attempts';
--
-- select conname from pg_constraint
--   where conrelid = 'public.session_recording_chunks'::regclass
--   and conname = 'session_recording_chunks_attempt_track_sequence_key';
--   → должен существовать; старого session_recording_chunks_session_id_track_sequence_key
--   быть не должно.
-- ------------------------------------------------------------

-- ============================================================
-- ЧАСТЬ 2 (ОТДЕЛЬНО, ТРЕБУЕТ ДОПОЛНИТЕЛЬНОГО ЯВНОГО РАЗРЕШЕНИЯ,
-- НЕ ПРИМЕНЯТЬ ВМЕСТЕ С ЧАСТЬЮ 1 БЕЗ ОТДЕЛЬНОГО ОБСУЖДЕНИЯ):
--
-- RLS-политики storage.objects (own_session_recordings_insert/update,
-- migration_037) сейчас разрешают психологу-владельцу сессии писать
-- (INSERT) и перезаписывать (UPDATE) ЛЮБОЙ объект в
-- recordings/{session_id}/** через СВОЙ ОБЫЧНЫЙ authenticated-клиент
-- (браузерный supabase.storage.from(...).upload()/.update()), НАПРЯМУЮ,
-- в обход серверного .../recording/chunks/authorize и всей описанной
-- выше логики attempt_id. Это подтверждено 24.09 прямым чтением
-- pg_policies, не предположением. Путь ЭТОЙ политики не завязан на
-- track/attempt_id/sequence вообще — она проверяет только второй
-- сегмент пути как session_id, поэтому даже после части 1 этой
-- миграции ничто на уровне Storage RLS не мешает психологу выложить
-- произвольные байты по произвольному "правдоподобному" пути внутри
-- своей сессии в обход всей серверной проверки.
--
-- Предлагаемое закрытие (готовится, НЕ применено, требует
-- эмпирической проверки на живом тесте, что signed-upload URL
-- продолжит работать без RLS-политик authenticated — по документации
-- Supabase, выдача токена (createSignedUploadUrl) проверяет RLS в
-- момент выдачи для того, КТО его запросил, а сама загрузка по
-- токену (uploadToSignedUrl) авторизуется самим токеном, не заново
-- через RLS — то есть теоретически эти политики можно убрать для
-- role authenticated совсем, переведя authorize-route на service-role
-- клиент ТОЛЬКО для вызова createSignedUploadUrl, ПОСЛЕ того как route
-- сам проверил владение сессией через cookie-based клиент, как и
-- сейчас):
--
-- drop policy if exists "own_session_recordings_insert" on storage.objects;
-- drop policy if exists "own_session_recordings_update" on storage.objects;
-- drop policy if exists "own_session_recordings_select" on storage.objects;
--
-- После этого ЕДИНСТВЕННЫЙ способ получить запись в этот bucket —
-- подписанный токен, выданный authorize-route (service-role), который
-- сам вычисляет путь и не принимает произвольный путь от браузера.
-- Прямой вызов storage.upload()/.update() из браузерного клиента
-- начнёт получать 403 (RLS deny by default, политик не останется).
--
-- НЕ ПРИМЕНЯТЬ без вашего отдельного разрешения даже после части 1:
-- это меняет поведение уже работающего (пусть и небезопасного) пути,
-- и должно быть подтверждено живым тестом ПОСЛЕ применения на
-- preview/staging, а не сразу на проде.
-- ============================================================
