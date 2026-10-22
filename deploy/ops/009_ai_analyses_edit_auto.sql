-- Итоги сессии: правка блоков психологом (update) и пометка «создано автоматически после расшифровки».
alter table public.client_ai_analyses add column if not exists auto boolean not null default false;
alter table public.client_ai_analyses add column if not exists edited_at timestamptz;
drop policy if exists client_ai_analyses_update_own on public.client_ai_analyses;
create policy client_ai_analyses_update_own on public.client_ai_analyses for update to authenticated
  using (psychologist_id = auth.uid()) with check (psychologist_id = auth.uid());
grant update on public.client_ai_analyses to authenticated;
notify pgrst, 'reload schema';
select 'client_ai_analyses: edit+auto ok' as result;
