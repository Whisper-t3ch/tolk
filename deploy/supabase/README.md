# Self-hosted Supabase для ТОЛК (staging на сервере в РФ)

Что это: Supabase (Postgres + Auth + REST + Storage + шлюз) в Docker на нашем сервере. Код ТОЛК не меняется —
меняются только адрес и ключи. Реально нужные компоненты определены по коду (06.10.2026): вход по email+паролю,
таблицы/RLS/RPC, pgvector, Storage с подписанной загрузкой. Не используются и отключены: realtime, edge-функции, Studio, imgproxy, пулер.
Облачная БД не изменяется и остаётся резервной.

**Статус: не запускалось.** Набор собран без возможности поднять Docker, первый запуск делается на тестовом сервере.
Данные в облаке — только тестовые (БД 18 МБ, 3 пользователя), поэтому переносится СХЕМА, пользователи регистрируются заново.

## Что понадобится
- Сервер с Docker Compose >= 2.24 (на ASR-ВМ Яндекса уже есть Docker; проверка: `docker compose version`).
- DNS-запись `db.tolkplace.ru` (A) на IP сервера (новая запись; основной tolkplace.ru не трогаем).
- Строка подключения к облачной БД (Supabase -> Connect -> Session pooler; пароль БД). Вводится в скрипт скрытым вводом, в чат не присылать.

## Шаги (на сервере)
1. Скопировать папку: `scp -r deploy/supabase ubuntu@<IP>:~/supabase` (с вашего ПК), затем `ssh ...` и
   `cd ~/supabase && sed -i 's/\r$//' *.sh utils/*.sh volumes/api/envoy/docker-entrypoint.sh && chmod +x *.sh utils/*.sh`.
2. `./sb.sh init https://db.tolkplace.ru https://stage.tolkplace.ru` — создаёт `.env`, ключи генерируются и НЕ печатаются.
3. `./sb.sh up`, через 1–2 минуты `./sb.sh status` — db, auth, rest, storage, api-gw в состоянии healthy.
4. Проверка шлюза: `curl -s -o /dev/null -w '%{http_code}\n' http://172.17.0.1:8000/auth/v1/health -H "apikey: $(grep ^ANON_KEY .env | cut -d= -f2)"` — должно быть 200.
5. Схема из облака: `./migrate_from_cloud.sh` (спросит строку подключения). В конце — сверка прав и RLS «облако vs локально».
6. `./sb.sh smoke` — тест изнутри; все пункты должны быть PASS (таблицы и триггер уже перенесены).
7. Публикация через Caddy (см. ниже), затем `./sb.sh smoke https://db.tolkplace.ru`.
8. Переключить staging на новый Supabase: `./sb.sh sync-frontend ~/asr-service/.env.frontend`, затем `cd ~/asr-service && ./frontend.sh build && ./frontend.sh up`.
   В Supabase Auth (self-hosted) redirect-адреса уже заданы `init`-ом (SITE_URL и `/**`).
9. Бэкап: `./backup_db.sh` вручную один раз, затем cron (строка в шапке скрипта).

## Публикация через Caddy
В `deploy/frontend` добавлен блок `db.tolkplace.ru` (переменная `DB_DOMAINS`): Caddy принимает HTTPS и проксирует на шлюз Supabase
(`host.docker.internal:8000`, шлюз слушает только адрес docker-моста). В `.env.frontend` добавить `DB_DOMAINS=db.tolkplace.ru`,
затем `./frontend.sh up` (Caddy пересоздаётся, у asr.tolkplace.ru кратковременный сбой).
Порт 8000 и порты Postgres наружу НЕ открывать.

## Откат
Вернуть в `.env.frontend` облачные `NEXT_PUBLIC_SUPABASE_URL`/ключи, `./frontend.sh build && ./frontend.sh up`. Данные в облаке не тронуты.

## Известные риски и что проверяем на первом запуске
- Envoy мог быть собран с расчётом на все сервисы: если `api-gw` не стартует — см. комментарий в `docker-compose.beta.yml`.
- `migrate_from_cloud.sh` может упасть на GRANT к ролям, которых нет локально; пришлите последние 20 строк вывода (без пароля).
- Почта: `ENABLE_EMAIL_AUTOCONFIRM=true` только для staging. Для беты нужно решить: SMTP (письма подтверждения/сброса) или закрытая регистрация.
- Секреты (`.env`, ключи) в git и в чат не попадают. `SERVICE_ROLE_KEY` печатать нельзя.
- Нагрузочные сценарии (регистрация, чанки аудио, запросы) добавляются отдельным шагом после зелёного smoke-теста.
