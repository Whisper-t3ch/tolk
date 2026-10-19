-- Аватарки клиентов из мессенджеров (Telegram): маленькое фото (data URL) на карточке клиента.
-- avatar_checked_at — когда в последний раз пытались подтянуть, чтобы не дёргать Telegram на каждое сообщение.
alter table public.clients add column if not exists avatar_data text;
alter table public.clients add column if not exists avatar_checked_at timestamptz;
notify pgrst, 'reload schema';
