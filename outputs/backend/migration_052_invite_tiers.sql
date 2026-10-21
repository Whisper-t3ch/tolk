-- Закрытая бета: тарифы, привязанные к инвайт-коду.
--   beta_paid  — «платники»: 400 запросов к ассистенту в месяц
--   beta_free  — пробный: 50 запросов на весь срок, доступ N дней (access_days), без месячного сброса
--   unlimited  — владелец / команда: практически без лимита
-- Лимиты — в src/lib/assistantLimits.ts (PLAN_LIMITS). Срок доступа — psychologists.access_expires_at.
-- Применять: sudo docker exec -i supabase-db psql -U supabase_admin -d postgres < migration_052_invite_tiers.sql

-- 1. Срок доступа психолога
alter table public.psychologists add column if not exists access_expires_at timestamptz;

-- 2. Новые значения plan_name (имя check-констрейнта могло отличаться — снимаем любой check по plan_name)
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.psychologists'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%plan_name%'
  loop
    execute format('alter table public.psychologists drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.psychologists
  add constraint psychologists_plan_name_check
  check (plan_name in ('beta','practice','professional','expert','beta_paid','beta_free','unlimited'));

-- 3. Тариф и срок доступа в самом коде
alter table public.invite_codes add column if not exists plan_name   text not null default 'beta';
alter table public.invite_codes add column if not exists access_days int;

notify pgrst, 'reload schema';
