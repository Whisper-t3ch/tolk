-- ============================================================
-- migration_030_soap_generation_jobs.sql
--
-- Поддержка асинхронной генерации SOAP-протокола через
-- completionAsync YandexGPT (~вдвое дешевле синхронного режима —
-- 0.61₽/1000 токенов вместо 1.2₽/1000 для Pro, см. пересчёт биллинга
-- от 17.09). SOAP не требует мгновенного ответа: психолог запускает
-- генерацию уже ПОСЛЕ завершения сессии, задержка в 2-4 минуты не
-- критична для UX (решение принято явно, не подразумевается).
--
-- Отдельная таблица, а не новые колонки в soap_notes: soap_notes
-- хранит РЕЗУЛЬТАТ (текст протокола), а не служебное состояние
-- одного запроса на генерацию. Job естественным образом одноразовый
-- и короткоживущий (обычно завершается за минуты) — хранить его
-- статус рядом с постоянными данными протокола означало бы либо
-- захламлять soap_notes служебными полями, либо усложнять его RLS.
--
-- Поллинг с фронтенда идёт по id job'а, не по session_id напрямую,
-- чтобы повторный запуск генерации (психолог нажал "Сгенерировать"
-- ещё раз, не дождавшись первой) не путал старую и новую операцию.
--
-- Применять через Supabase SQL Editor. Идемпотентно.
-- ============================================================

create table if not exists soap_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  psychologist_id uuid not null references psychologists(id) on delete cascade,
  operation_id text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'error')),
  result jsonb,
  error_message text,
  template_id uuid references knowledge_base(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists soap_generation_jobs_session_id_idx on soap_generation_jobs(session_id);

alter table soap_generation_jobs enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select polname
    from pg_policy
    where polrelid = 'public.soap_generation_jobs'::regclass
  loop
    execute format('drop policy %I on soap_generation_jobs', pol.polname);
  end loop;
end $$;

create policy soap_generation_jobs_select on soap_generation_jobs
  for select using (psychologist_id = auth.uid());

create policy soap_generation_jobs_insert on soap_generation_jobs
  for insert with check (psychologist_id = auth.uid());

create policy soap_generation_jobs_update on soap_generation_jobs
  for update using (psychologist_id = auth.uid());
