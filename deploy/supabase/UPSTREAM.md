# Источник vendored-файлов

Файлы `docker-compose.yml`, `.env.example`, `volumes/api/envoy/*`, `volumes/db/*.sql`, `utils/generate-keys.sh`
скопированы БЕЗ ИЗМЕНЕНИЙ из официального репозитория Supabase, каталог `docker/`
(https://github.com/supabase/supabase/tree/master/docker), ветка master, снято 06.10.2026.
Версии образов в `docker-compose.yml` зафиксированы upstream-ом (db: supabase/postgres 17.6.1.136, auth: gotrue v2.196.0,
rest: postgrest v14.17, storage: storage-api v1.74.0, gateway: envoy v1.39.1).
Свои правки — только в `docker-compose.beta.yml` и в скриптах. Обновлять upstream-файлы вручную и осознанно.
