-- ============================================================
-- migration_041_recording_jobs.sql
--
-- Этап 3.4 (02.10.2026): идемпотентная очередь задач на транскрипцию
-- завершённых записей. Без выделенного воркер-процесса (нет своей ВМ
-- под него) — модель: Vercel Cron периодически бьёт
-- /api/jobs/process (см. vercel.json), роут claim-ит ОДНУ задачу через
-- claim_recording_job() ниже и обрабатывает её synchronous в рамках
-- того же HTTP-вызова. Это достаточно для ожидаемого масштаба (15-20
-- сессий/день, см. production-rollout-runbook.md) — для будущего
-- реального масштабирования можно заменить на отдельный воркер-процесс
-- на той же ВМ, что и Jitsi/GigaAM, без изменения схемы этой таблицы.
--
-- НЕ ПРИМЕНЕНО К ПРОД-БД — только к тестовому Supabase-проекту
-- (jjwfmcxiogcjunuoziau) для Preview-проверки, тем же протоколом, что
-- и предыдущие миграции этого проекта.
-- ============================================================

create table if not exists public.recording_jobs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  -- Зарезервировано под будущие типы задач (например, пересчёт SOAP
  -- отдельно от транскрипции) — сейчас всегда 'transcribe'.
  job_type text not null default 'transcribe' check (job_type in ('transcribe')),
  -- 'blocked' — сборка/ASR прошли, но процесс не может продолжиться по
  --   инфраструктурной причине, не по ошибке данных (пример на 02.10:
  --   ASR_SERVICE_URL ещё не настроен, т.к. ВМ ещё не развёрнута) —
  --   отличается от 'failed' (реальный сбой/повреждённые данные,
  --   требует внимания человека, не просто ожидания инфраструктуры).
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'blocked')),
  attempts_count int not null default 0,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Идемпотентность постановки в очередь: повторный manifest того же
  -- session_id (например, пересчёт статуса confirm-роутом по мере
  -- дозагрузки) не создаёт вторую задачу — см. enqueueTranscriptionJob()
  -- в src/lib/recording/jobQueue.ts, которая трактует конфликт этого
  -- ключа как "уже в очереди", а не как ошибку.
  unique (session_id, job_type)
);

create index if not exists recording_jobs_status_idx on public.recording_jobs(status);
create index if not exists recording_jobs_session_idx on public.recording_jobs(session_id);

alter table public.recording_jobs enable row level security;
-- Намеренно НЕТ политик для role authenticated: это внутренняя очередь
-- обработки, с ней работает только service-role (createAdminClient()) —
-- ни браузер психолога, ни клиент не должны читать или писать эту
-- таблицу напрямую. RLS enabled + 0 policies = deny-all для
-- authenticated, как и было осознанно сделано для session_recording_chunks
-- до миграции 038 Часть 2 (тот же паттерн, на этот раз — намеренно и
-- навсегда, не временная дыра).

-- ------------------------------------------------------------
-- Атомарный claim одной задачи. FOR UPDATE SKIP LOCKED защищает от
-- гонки двух параллельных вызовов /api/jobs/process (ручной
-- fire_trigger мог теоретически перекрыться с плановым срабатыванием
-- Vercel Cron). Условие по locked_at забирает "зависшую" processing-
-- задачу, если предыдущий воркер упал, не разблокировав её (например,
-- серверная ошибка/таймаут Vercel-функции на середине обработки) —
-- p_stale_after_seconds задаёт, сколько ждать перед повторным claim.
-- ------------------------------------------------------------
create or replace function public.claim_recording_job(p_locked_by text, p_stale_after_seconds int default 600)
returns setof public.recording_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update public.recording_jobs
    set status = 'processing',
        locked_at = now(),
        locked_by = p_locked_by,
        attempts_count = recording_jobs.attempts_count + 1,
        updated_at = now()
    where id = (
      select rj.id from public.recording_jobs rj
      where rj.status = 'pending'
         or (rj.status = 'processing' and rj.locked_at < now() - (p_stale_after_seconds || ' seconds')::interval)
      order by rj.created_at asc
      for update skip locked
      limit 1
    )
    returning *;
end;
$$;

comment on function public.claim_recording_job is
  'Атомарный claim одной задачи очереди Этапа 3 (транскрипция) — см. заголовок migration_041_recording_jobs.sql. Вызывается ТОЛЬКО service-role (createAdminClient) из /api/jobs/process, см. src/lib/recording/jobQueue.ts.';

-- security definer, потому что вызывающая роль (service_role через
-- admin-клиент) и так имеет полный доступ — definer здесь только для
-- того, чтобы функция гарантированно резолвила public.recording_jobs
-- независимо от search_path вызывающей сессии, не ради повышения
-- привилегий.
--
-- НАЙДЕНО И ИСПРАВЛЕНО 02.10.2026 ПРИ ПРИМЕНЕНИИ НА ТЕСТОВЫЙ ПРОЕКТ
-- (mcp__Supabase__get_advisors, security): по умолчанию Postgres даёт
-- EXECUTE на новую функцию роли PUBLIC, а SECURITY DEFINER означает,
-- что она исполняется с правами ВЛАДЕЛЬЦА (полный доступ), а не
-- вызывающего — то есть без явного REVOKE анонимный/authenticated
-- пользователь мог бы дёрнуть её напрямую через
-- /rest/v1/rpc/claim_recording_job и claim-ить/мутировать
-- recording_jobs МИМО RLS (который на этой таблице и так deny-all для
-- authenticated, но security definer это обходит). Комментарий выше
-- ("вызывается ТОЛЬКО service-role") был декларацией намерения, не
-- реальным ограничением доступа — это и есть разница.
revoke execute on function public.claim_recording_job(text, int) from public, anon, authenticated;
grant execute on function public.claim_recording_job(text, int) to service_role;

-- ------------------------------------------------------------
-- Проверки после применения (выполнить вручную):
--
-- select table_name from information_schema.tables
--   where table_schema='public' and table_name='recording_jobs';
--
-- select proname from pg_proc where proname = 'claim_recording_job';
-- ------------------------------------------------------------
