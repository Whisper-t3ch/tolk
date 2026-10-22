-- ИИ-анализы по кнопке: обзор клиента, анализ теста, разбор сессии (с ИИ-оценкой состояния 0–10).
-- ref: для 'test' — test_type (например PHQ9), для 'session' — id сессии, для 'overview' — null.
create table if not exists public.client_ai_analyses (
  id uuid primary key default gen_random_uuid(),
  psychologist_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('overview', 'test', 'session')),
  ref text,
  content jsonb not null,
  score numeric,
  created_at timestamptz not null default now()
);
create index if not exists client_ai_analyses_lookup on public.client_ai_analyses (client_id, kind, ref, created_at desc);
alter table public.client_ai_analyses enable row level security;
drop policy if exists client_ai_analyses_select_own on public.client_ai_analyses;
drop policy if exists client_ai_analyses_insert_own on public.client_ai_analyses;
drop policy if exists client_ai_analyses_delete_own on public.client_ai_analyses;
create policy client_ai_analyses_select_own on public.client_ai_analyses for select to authenticated using (psychologist_id = auth.uid());
create policy client_ai_analyses_insert_own on public.client_ai_analyses for insert to authenticated with check (psychologist_id = auth.uid());
create policy client_ai_analyses_delete_own on public.client_ai_analyses for delete to authenticated using (psychologist_id = auth.uid());
grant select, insert, delete on public.client_ai_analyses to authenticated;
grant all on public.client_ai_analyses to service_role;
notify pgrst, 'reload schema';
select 'client_ai_analyses: ok' as result;
