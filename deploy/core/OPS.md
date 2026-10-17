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
