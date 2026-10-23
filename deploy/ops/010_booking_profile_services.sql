-- Публичная запись: профиль специалиста, услуги, отзывы; название услуги в брони.
alter table public.booking_settings add column if not exists profile jsonb not null default '{}'::jsonb;
alter table public.booking_settings add column if not exists services jsonb not null default '[]'::jsonb;
alter table public.booking_settings add column if not exists reviews jsonb not null default '[]'::jsonb;
alter table public.sessions add column if not exists service_title text;
notify pgrst, 'reload schema';
select 'booking profile/services: ok' as result;
