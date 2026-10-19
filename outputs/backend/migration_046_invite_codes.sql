-- Закрытая бета: регистрация только по инвайт-коду.
-- Коды выдаёт владелец (SQL ниже). Один код может быть общим (max_uses > 1) или персональным (max_uses = 1).
-- Таблица доступна только service role (RLS включён, политик нет).

create table if not exists public.invite_codes (
  code        text primary key,
  note        text,
  max_uses    int  not null default 1,
  uses        int  not null default 0,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.invite_codes enable row level security;

-- Атомарно занимает одно использование кода. true — код валиден и использование списано.
create or replace function public.consume_invite_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.invite_codes
     set uses = uses + 1
   where code = lower(trim(p_code))
     and uses < max_uses
     and (expires_at is null or expires_at > now());
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- Возвращает использование, если регистрация после списания не удалась.
create or replace function public.release_invite_code(p_code text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.invite_codes set uses = greatest(uses - 1, 0) where code = lower(trim(p_code));
$$;

revoke all on function public.consume_invite_code(text) from public, anon, authenticated;
revoke all on function public.release_invite_code(text) from public, anon, authenticated;
grant execute on function public.consume_invite_code(text) to service_role;
grant execute on function public.release_invite_code(text) to service_role;

notify pgrst, 'reload schema';

-- Примеры выдачи кодов:
--   insert into public.invite_codes (code, note, max_uses) values ('beta-tolk-2026', 'общий код беты', 30);
--   insert into public.invite_codes (code, note) values ('ivanova-7k3q', 'Иванова', 1);
--   select code, note, uses, max_uses from public.invite_codes order by created_at desc;
