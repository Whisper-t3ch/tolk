# Эксплуатация и перенос: шпаргалка (15.10.2026)

Все команды НА core2 (ssh ubuntu@37.139.35.119). Секреты вводятся скрытно, в чат не присылать. Cron включается только по решению владельца.

## Репетиция переноса данных (боевое не трогает, облако только читается)
```
cd ~/supabase && sed -i 's/\r$//' *.sh *.py && chmod +x *.sh *.py
./migrate_data.sh          # спросит строку Session pooler облачной БД и YES; сделает бэкап локальной БД
./verify_migration.sh      # счётчики облако vs локально по каждой таблице + auth
./migrate_storage.py --list
./migrate_storage.py       # записи: копирует и сверяет sha256 (идемпотентно, можно повторять)
./sb.sh smoke https://db.tolkplace.ru
```
Фиксируйте время каждого шага: оно пойдёт в окно переноса. Повторять минимум дважды.

## Cron (пользовательский crontab: `crontab -e`)
```
*/1 * * * * /home/ubuntu/core/jobs_cron.sh >> /var/log/tolk-jobs.log 2>&1
15 3 * * *  RCLONE_REMOTE=tolkbk:tolk-backups /home/ubuntu/supabase/backup_db.sh >> /var/log/tolk-backup.log 2>&1
*/5 * * * * /home/ubuntu/core/monitor_alert.sh >> /var/log/tolk-monitor.log 2>&1
```
Файлы логов создать заранее: `sudo touch /var/log/tolk-{jobs,backup,monitor}.log && sudo chown ubuntu /var/log/tolk-*.log`.

## Внешняя копия бэкапов (rclone, S3-совместимое хранилище)
1. В консоли хостинга создать приватный бакет и ключи доступа (адрес эндпоинта, ключи брать из консоли).
2. `sudo apt-get install -y rclone && rclone config` → новое хранилище `tolkbk`, тип S3 (Other/Ceph), endpoint, access key, secret key.
3. Проверка: `rclone mkdir tolkbk:tolk-backups && echo ok | rclone rcat tolkbk:tolk-backups/test.txt && rclone ls tolkbk:tolk-backups`.
4. В cron-строке бэкапа задан `RCLONE_REMOTE=tolkbk:tolk-backups`. Проверка восстановимости раз в неделю: см. конец `backup_db.sh`.
Бэкапы содержат персональные данные: бакет приватный, ключи ограниченные, шифрование на стороне хранилища включить.

## Оповещения
1. Создать `~/core/.alert.env` (chmod 600) с `TG_BOT_TOKEN=...` и `TG_CHAT_ID=...` и/или `ALERT_WEBHOOK_URL=...`.
2. `./monitor_alert.sh test`: проверка канала (доступность Telegram из РФ проверить заранее; если нет, использовать webhook другого мессенджера).
3. Внешний взгляд на сайт с ASR-ВМ: `*/5 * * * * /home/ubuntu/core/monitor_alert.sh external https://tolkplace.ru/api/health`.

## Боевое переключение (в окно переноса)
```
cd ~/core && ./switch_domain.sh prod      # правит .env.core и Supabase SITE_URL, пересобирает, перезапускает
# сразу DNS на reg.ru: A tolkplace.ru и www -> 37.139.35.119
# откат: ./switch_domain.sh stage (и DNS назад на Vercel)
```

## Авто-выкатка мелких UI-фиксов (auto_deploy.sh)

Облачная задача «ТОЛК: обращения → фикс → пуш» пушит исправления в ветку `auto/support-fixes`.
`auto_deploy.sh` (cron, каждые 5 минут, НА core) забирает ветку по read-only deploy key и выкатывает
только безопасные правки: `src/**/*.tsx|css`, ≤ 8 файлов и ≤ 300 строк, без `api/`, middleware, auth/login/billing/supabase,
без fetch/eval/process.env/внешних URL в добавленных строках. Патч накладывается на `~/tolk-src`, затем `./core.sh build && up`,
проверка `/api/health` и `/login`; при сбое — `./core.sh rollback` и откат исходников. Результат — в Telegram (`.alert.env`).

Установка:
1. `mkdir -p ~/auto-deploy && ssh-keygen -t ed25519 -N '' -f ~/auto-deploy/deploy_key -C tolk-autodeploy && cat ~/auto-deploy/deploy_key.pub`
   → GitHub: репозиторий → Settings → Deploy keys → Add (БЕЗ галки write access).
2. Положить `auto_deploy.sh` в `~/core`, `chmod +x`, `sed -i 's/\r$//'`.
3. Проверка вручную: `~/core/auto_deploy.sh` (без ветки или без изменений молчит).
4. Cron: `*/5 * * * * /home/ubuntu/core/auto_deploy.sh >> /home/ubuntu/tolk-autodeploy.log 2>&1`

Управление: `touch ~/auto-deploy/DISABLED` — выключить; `rm ~/auto-deploy/rejected` — снять блокировку после разбора отказа.
После слияния `auto/support-fixes` в рабочую ветку и обычного деплоя снапшотом ничего делать не нужно: уже применённые изменения скрипт пропускает.

## Выкатка по pull: ветка release/prod (release_deploy.sh)

Я (Claude) после зелёных tsc и тестов пушу в `release/prod`; cron на core каждую минуту сверяет `git ls-remote` с `~/tolk-src/.git_commit`
и, если коммит новый, делает `git archive` поверх `~/tolk-src`, `./core.sh build && up`, проверку `/api/health` и `/login`, при сбое — `rollback`.
Итог — в Telegram. Ручной деплой снапшотом работает как раньше (скрипт видит, что `.git_commit` уже равен HEAD ветки, и молчит).
Замок общий с `auto_deploy.sh`, одновременно они не идут. Скрипт сам обновляет свою копию в `~/core` после успешной выкатки.

Миграции БД НЕ применяются автоматически. Если в коммите есть `outputs/backend/migration_NNN_*.sql` с NNN больше числа в `~/release-deploy/migrations_upto`,
выкатка ждёт и один раз пишет в Telegram. Применить SQL (`sudo docker exec -i supabase-db psql -U supabase_admin -d postgres < файл.sql`),
затем `echo NNN > ~/release-deploy/migrations_upto` — следующая минута выкатит сама.

Установка (один раз): ключ — тот же read-only deploy key (`~/auto-deploy/deploy_key`) или свой в `~/release-deploy/deploy_key`.
`mkdir -p ~/release-deploy && echo <последняя применённая миграция> > ~/release-deploy/migrations_upto`;
`cp ~/tolk-src/deploy/core/release_deploy.sh ~/core/ && chmod +x ~/core/release_deploy.sh && sed -i 's/\r$//' ~/core/release_deploy.sh`;
cron: `* * * * * /home/ubuntu/core/release_deploy.sh >> /home/ubuntu/tolk-release-deploy.log 2>&1`.
Управление: `touch ~/release-deploy/DISABLED` — выключить; `rm ~/release-deploy/rejected` — снять блокировку после отказа; лог — `~/tolk-release-deploy.log`.
Безопасность: кто может писать в `release/prod`, тот выкатывает код на прод — включите защиту ветки (запрет force-push, пуши только владельца и Claude).

## Инвайт-коды и тарифы беты

Регистрация только по коду (`invite_codes`). Тариф и срок доступа привязаны к коду (migration 052):
`beta_paid` — 400 запросов/мес; `beta_free` — 50 запросов на весь срок, доступ `access_days` (14) дней, без месячного сброса; `unlimited` — владелец/команда.
Выдать: `outputs/backend/issue_beta_invite_codes.sql` (14 платных + 10 пробных + 1 безлимит, в конце — список кодов).
Список/статус: `select code, note, plan_name, uses, max_uses from invite_codes order by plan_name, note;`

Продлить пробного на 2 недели и обнулить запросы:
`update psychologists set access_expires_at = now() + interval '14 days', assistant_requests_used = 0 where email = 'x@y.ru';`
Перевести на другой тариф: `update psychologists set plan_name = 'beta_paid', access_expires_at = null where email = '...';`
Добавить запросов: `update psychologists set assistant_extra_requests = assistant_extra_requests + 50 where email = '...';`
Безлимит себе: `update psychologists set plan_name = 'unlimited' where email = '...';`
Докупка и самостоятельная смена тарифа для этих трёх тарифов закрыта (403, «напишите в Помощь»).

## Разовые SQL-задачи через push (deploy/ops/)
Файл `deploy/ops/NNN_имя.sql` в ветке release/prod выполняется на сервере один раз (release_deploy.sh, ≤1 мин после пуша): `psql` в supabase-db одной транзакцией,
результат (вывод запроса или ошибка) приходит в Telegram. Журнал — `~/release-deploy/ops_done`; повторить задачу — удалить её имя оттуда.
Для выдачи кодов, переименования аккаунта и т.п. Миграции схемы по-прежнему через `migrations_upto`. Необратимое удаление данных этим путём не делаем.
