-- Опросники в сессии: тест можно привязать к сессии и пометить «в начале» / «в конце».
alter table public.test_results add column if not exists session_id uuid references public.sessions(id) on delete set null;
alter table public.test_results add column if not exists phase text;
do $$ begin
  alter table public.test_results add constraint test_results_phase_check check (phase is null or phase in ('before','after'));
exception when duplicate_object then null; end $$;
create index if not exists test_results_session_idx on public.test_results (session_id) where session_id is not null;
notify pgrst, 'reload schema';
select 'test_results session/phase: ok' as result;
