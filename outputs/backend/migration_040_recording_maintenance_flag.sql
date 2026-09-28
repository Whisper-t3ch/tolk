-- ============================================================
-- migration_040_recording_maintenance_flag.sql
--
-- Готовится и тестируется ЗАРАНЕЕ, независимо от миграций 038/039 и
-- от даты production-окна замены constraint (см. рантбук Фазы 2 в
-- чате/claude/recording-stop-fix-plan.md). Полностью аддитивна: не
-- трогает session_recording_chunks/recording_attempts и не требует
-- migration_038/039 — можно применять на любую БД в любой момент,
-- поведение при enabled=false не меняется вообще.
--
-- ЗАЧЕМ: во время короткого окна (снятие старого constraint на
-- session_recording_chunks + ожидание READY нового production-
-- деплоя) старый и новый код НЕСОВМЕСТИМЫ с constraint друг друга
-- (см. обсуждение onConflict в чате) — любая попытка реально
-- записать chunk в этот момент упадёт на уровне БД с малопонятной
-- ошибкой. Этот флаг даёт явный, управляемый способ остановить
-- запись НА УРОВНЕ ПРИЛОЖЕНИЯ, ДО обращения к таблице с constraint,
-- одним UPDATE без нового деплоя (в отличие от переменных окружения
-- Vercel, которые требуют новой сборки, чтобы отдать новое значение
-- уже работающим serverless-функциям).
--
-- ГДЕ ПРОВЕРЯЕТСЯ (см. патч route.ts в этом же коммите) — единым
-- хелпером src/lib/maintenance.ts:
--   - POST .../recording/attempts        (старт новой попытки записи)
--   - POST .../recording/chunks/authorize (выдача signed URL)
--   - POST .../recording/chunks           (confirm — сам upsert с
--                                          constraint)
--   - POST .../recording/manifest         (финализация — не пишет в
--                                          session_recording_chunks,
--                                          но пишет sessions.recording_*
--                                          и не должна давать ложный
--                                          "incomplete" статус из-за
--                                          самого окна обслуживания)
-- Плюс отдельно, тем же полем в ответе, в GET .../soap — чтобы
-- страница звонка (session/[id]/page.tsx) могла показать баннер и НЕ
-- монтировать JitsiCallView вообще, а не просто получать 503 глубоко
-- внутри recorder'а. Это разовая проверка при загрузке страницы, не
-- поллинг — не замена самому запрету записи выше, а его UX-дополнение.
--
-- ДОСТУП (по итогам ревью):
--   - anon вообще не имеет доступа к таблице — единственная точка,
--     где сейчас читается флаг (GET .../soap и все .../recording/*
--     routes), уже требует авторизованного пользователя, отдельного
--     баннера ДО логина не показываем, поэтому расширять доступ до
--     anon незачем.
--   - authenticated получает SELECT ТОЛЬКО на колонку enabled —
--     колонка message (внутренние заметки на время обслуживания, не
--     пользовательский текст) никому, кроме service_role, не
--     выдаётся; пользовательский текст баннера — фиксированная
--     строка в самом коде приложения, не значение из БД.
--   - INSERT/UPDATE/DELETE не разрешены НИКОМУ, кроме service_role —
--     ни грантом, ни политикой. Переключение флага (в т.ч. в
--     production, когда до этого дойдёт) — отдельное, каждый раз
--     явно подтверждаемое действие с service_role/SQL-редактором, а
--     не часть обычного пути приложения.
-- ============================================================

create table if not exists public.app_maintenance_flags (
  key text primary key,
  enabled boolean not null default false,
  -- Внутренние заметки (например, "почему включено", "до какого
  -- времени по плану") — НЕ предназначено для показа пользователю и
  -- не выдаётся ни anon, ни authenticated (см. GRANT ниже).
  message text,
  updated_at timestamptz not null default now()
);

insert into public.app_maintenance_flags (key, enabled)
values ('recording_writes', false)
on conflict (key) do nothing;

alter table public.app_maintenance_flags enable row level security;

drop policy if exists "maintenance_flags_select" on public.app_maintenance_flags;

-- using(true): флаг не привязан к владению какой-либо строкой — это
-- один общий переключатель на всё приложение, а не пользовательские
-- данные. Явно ограничена ролью authenticated (не anon, не public).
create policy "maintenance_flags_select" on public.app_maintenance_flags
  for select
  to authenticated
  using (true);
-- Нет ни одной политики INSERT/UPDATE/DELETE — при включённом RLS
-- отсутствие политики на команду означает безусловный запрет этой
-- команды для всех ролей, кроме тех, что обходят RLS (service_role).

revoke all on public.app_maintenance_flags from public;
revoke all on public.app_maintenance_flags from anon;
revoke all on public.app_maintenance_flags from authenticated;

-- SELECT нужен и на enabled, и на key: приложение фильтрует
-- .eq("key", "recording_writes") -- Postgres обязан прочитать key,
-- чтобы применить WHERE-условие, поэтому грант только на enabled БЕЗ
-- key ломает именно этот, самый обычный вид запроса (найдено на
-- тесте allow/deny: "select enabled ... where key = ..." падал с
-- permission denied, хотя "select enabled ..." без WHERE проходил).
-- key -- не секрет и не персональные данные (имя флага-конфигурации),
-- выдавать его безопасно. message и updated_at по-прежнему не выданы
-- никому, кроме service_role.
grant select (key, enabled) on public.app_maintenance_flags to authenticated;
