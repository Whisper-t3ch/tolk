# ТОЛК — спецификация двух ВМ для production E2E (редакция 2 от 03.10.2026, вариант B)

Две ВМ: `tolk-jitsi` (видеозвонки) и `tolk-asr` (транскрибация GigaAM). Создаёт пользователь в Yandex Cloud; ничего не покупается без него.

Изменения относительно редакции 1: вариант B вместо одной ВМ; исправлена ошибка в `.env` Jitsi (XMPP-домены должны совпадать с публичным доменом, как в пилоте 27.09, иначе клиент ТОЛК не подключится); добавлен ASR-сервис (`asr-service/` в репозитории, ветка `feat/asr-service-03-10`); добавлены env/секреты и порядок включения.

## 1. Что создать руками в Yandex Cloud

| № | Что | Параметры |
|---|---|---|
| 1 | SSH-ключ | Новая пара на вашем компьютере: `ssh-keygen -t ed25519 -f tolk_vm_key`. Приватный `tolk_vm_key` не отправлять никому; для ВМ нужен только `tolk_vm_key.pub` |
| 2 | Два статических публичных IP | Зарезервировать два адреса в зоне ru-central1-a: `ip-jitsi`, `ip-asr` |
| 3 | Группа безопасности `sg-jitsi` | см. п. 2 |
| 4 | Группа безопасности `sg-asr` | см. п. 2 |
| 5 | ВМ `tolk-jitsi` | ru-central1-a; Intel Ice Lake (`standard-v3`); 4 vCPU (гарантированная доля 100%) / 8 ГБ RAM; Ubuntu 22.04 LTS; загрузочный диск SSD (network-ssd) 40 ГБ; не прерываемая; публичный IP = `ip-jitsi`; группа `sg-jitsi`; логин `ubuntu`, ключ из п. 1 |
| 6 | ВМ `tolk-asr` | ru-central1-a; Intel Ice Lake (`standard-v3`); 8 vCPU (100%) / 16 ГБ RAM; Ubuntu 22.04 LTS; SSD 60 ГБ; не прерываемая; публичный IP = `ip-asr`; группа `sg-asr`; логин `ubuntu`, тот же ключ |
| 7 | DNS | см. п. 3 |

Для обеих ВМ: одна и та же сеть и зона; дополнительные диски не нужны (записи хранятся в Supabase Storage, не на ВМ).

Стоимость (прайс Yandex Cloud с НДС: vCPU 1,24 ₽/ч, RAM 0,33 ₽/ГБ·ч, публичный IP 0,26 ₽/ч; диски оценочно, цену SSD сверьте в калькуляторе): `tolk-jitsi` около 6 100 ₽/мес при работе 24/7, `tolk-asr` около 11 900 ₽/мес, итого около 18 000 ₽/мес. Для теста на несколько часов: около 23 ₽ в час за обе. Остановленная ВМ не тарифицирует CPU и RAM, только диск и IP.

## 2. Группы безопасности

`sg-jitsi`, входящие:

| Порт | Протокол | Источник | Зачем |
|---|---|---|---|
| 80 | TCP | 0.0.0.0/0 | Let's Encrypt HTTP-01, редирект на HTTPS |
| 443 | TCP | 0.0.0.0/0 | Jitsi web и websocket-сигнализация |
| 10000 | UDP | 0.0.0.0/0 | медиа JVB |
| 22 | TCP | 2.60.38.167/32 | SSH только с вашего IP |
| 4443 | TCP | 0.0.0.0/0 | необязательно, TCP-фолбэк для сетей без UDP; в первом прогоне не включаем |

`sg-asr`, входящие:

| Порт | Протокол | Источник | Зачем |
|---|---|---|---|
| 80 | TCP | 0.0.0.0/0 | Let's Encrypt HTTP-01 |
| 443 | TCP | 0.0.0.0/0 | API ASR (у Vercel нет фиксированных IP, защита: TLS + Bearer-токен, проверка и в Caddy, и в самом сервисе) |
| 22 | TCP | 2.60.38.167/32 | SSH только с вашего IP |

Исходящий трафик в обеих группах: разрешить всё. Не открывать: 8080, 8000, 5222, 5280 и любые другие порты. Если ваш домашний IP сменится, SSH перестанет пускать: проверьте новый IP и поправьте правило в консоли (ВМ пересоздавать не нужно).

## 3. DNS

| Запись | Тип | Значение | TTL |
|---|---|---|---|
| `meet.tolkplace.ru` | A | `ip-jitsi` | 300 |
| `asr.tolkplace.ru` | A | `ip-asr` | 300 |

Перед запуском проверьте с любого компьютера: `nslookup meet.tolkplace.ru` и `nslookup asr.tolkplace.ru` должны вернуть именно эти IP, иначе Let's Encrypt не выдаст сертификаты. DNS самого `tolkplace.ru` (корень, `www`) пока не трогаем: домен ещё не подключён к проекту Vercel, и до успешного E2E на него ничего не Promote-ится.

## 4. Env и секреты

Кто что делает: переменные Vercel (шаги A и B ниже) выставляю я через доступ к проекту, по вашему разрешению настраивать production env поэтапно. Шаг A уже выставлен 03.10 (id переменной `P6lQj6uI8tZ3WmS3`, Production, ещё не задеплоен). Шаг B выставлю после того, как Jitsi поднят и проверен. Секреты шага B (`ASR_SERVICE_TOKEN`, `CRON_SECRET`) я сгенерирую заново, задам в Vercel с типом sensitive (после этого значение не читается обратно) и в чат не выведу; токен ASR запишу в `asr-service/.env` в вашей папке (в git не попадает), чтобы он уехал на ВМ вместе с `scp`, а `CRON_SECRET` положу в локальный файл вне git для ручного запуска воркера. Оговорка: значение проходит через мои вызовы инструментов, поэтому это тестовые секреты, которые нужно ротировать перед Promote и первыми реальными пользователями. Если хотите нулевой след, эти два значения можно задать самим в панели Vercel.

На ВМ `tolk-jitsi` (`.env` docker-jitsi-meet), пароли внутренних сервисов создаёт `./gen-passwords.sh`, вручную менять не надо:

```
PUBLIC_URL=https://meet.tolkplace.ru
JITSI_IMAGE_VERSION=<актуальный stable-тег, см. чек-лист 5.2>
HTTP_PORT=80
HTTPS_PORT=443
TZ=UTC
# XMPP-домены = публичный домен: клиент ТОЛК (src/lib/jitsi/config.ts) строит hosts.domain=meet.tolkplace.ru,
# muc=conference.meet.tolkplace.ru, focus=focus.meet.tolkplace.ru и анонимный вход на основном домене (как в пилоте 27.09)
XMPP_DOMAIN=meet.tolkplace.ru
XMPP_AUTH_DOMAIN=auth.meet.tolkplace.ru
XMPP_GUEST_DOMAIN=guest.meet.tolkplace.ru
XMPP_MUC_DOMAIN=conference.meet.tolkplace.ru
ENABLE_AUTH=0
ENABLE_GUESTS=0
ENABLE_LETSENCRYPT=1
LETSENCRYPT_DOMAIN=meet.tolkplace.ru
LETSENCRYPT_EMAIL=<ваш e-mail>
LETSENCRYPT_ACME_SERVER=letsencrypt
JVB_ADVERTISE_IPS=<ip-jitsi>
ENABLE_P2P=true          # штатное поведение; false — только для отдельного worst-case теста
JVB_ENABLE_APIS=rest,colibri
```

На ВМ `tolk-asr` (`asr-service/.env`):

```
ASR_DOMAIN=asr.tolkplace.ru
ASR_SERVICE_TOKEN=<openssl rand -hex 32>   # секрет №1
GIGAAM_MODEL=v3_e2e_ctc
TORCH_THREADS=8
```

В Vercel, проект `tolk`, окружение Production. Все изменения env действуют только на НОВЫЙ деплой, а `NEXT_PUBLIC_*` вшивается при сборке, поэтому после каждого шага нужен Redeploy production-деплоя (без Promote на домен).

Шаг A (до первого звонка; не секрет):

- `NEXT_PUBLIC_JITSI_DOMAIN` = `meet.tolkplace.ru`

Шаг B (до первого запуска воркера):

- `RECORDING_ASR_ADAPTER` = `http`
- `ASR_SERVICE_URL` = `https://asr.tolkplace.ru`
- `ASR_SERVICE_TOKEN` = то же значение, что секрет №1 на ASR-ВМ (секрет)
- `CRON_SECRET` = новое случайное значение, `openssl rand -hex 32` (секрет №2; ТОЛЬКО для ручного запуска: блок `crons` из `vercel.json` убран, автозапуска нет)

Оставить не заданными: `JITSI_JWT_APP_ID`, `JITSI_JWT_APP_SECRET` (в первом прогоне JWT не используется, режим anonymous).

Проверьте, что в Production уже заданы (я их значения не читаю): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `YANDEX_GPT_API_KEY`, `YANDEX_GPT_FOLDER_ID` (нужны для SOAP). Отдельно проверьте `NEXT_PUBLIC_APP_URL`: от него строится invite-ссылка клиента (`<NEXT_PUBLIC_APP_URL>/join/<token>`), на время теста он должен быть `https://tolk-three.vercel.app` (адрес production-деплоя), а не `tolkplace.ru`, который к проекту не подключён.

## 5. Чек-листы запуска

### 5.1 Подготовка (вы)

1. Создать SSH-ключ, IP, группы, ВМ, DNS по п. 1–3.
2. Прислать мне: оба IP, логин (`ubuntu`) и подтверждение, что DNS отдаёт нужные IP. Закрытый ключ не присылать.
3. Доступ ко мне на ВМ: я попробую подключиться по SSH со своей стороны; если сеть этого не позволит, я буду давать команды, а вы возвращать мне их вывод.

### 5.2 Jitsi-ВМ (`tolk-jitsi`)

1. `sudo apt update && sudo apt install -y git bc curl python3 && curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER` (перелогиниться).
2. `git clone https://github.com/jitsi/docker-jitsi-meet.git ~/jitsi && cd ~/jitsi`.
3. Выбрать закрепляемый тег: `git ls-remote --tags https://github.com/jitsi/docker-jitsi-meet | grep stable | tail -3`; в `.env` задать `JITSI_IMAGE_VERSION=<последний stable-тег>`. Не `:unstable` и не `latest`. Записать выбранный тег в проектный runbook.
4. `cp env.example .env && ./gen-passwords.sh`, затем внести значения из п. 4 (вручную, редактором, пароли `gen-passwords.sh` не трогать).
5. `mkdir -p ~/.jitsi-meet-cfg/{web,transcripts,prosody/config,prosody/prosody-plugins-custom,jicofo,jvb,jigasi,jibri}`.
6. Файл `docker-compose.override.yml` рядом с `docker-compose.yml`, чтобы монитор видел статистику JVB только с самого хоста:

```yaml
services:
  jvb:
    ports:
      - "127.0.0.1:8080:8080"
```

7. `docker compose up -d`; `docker compose ps` — web, prosody, jicofo, jvb в состоянии `Up`.
8. Проверки (я выполняю и возвращаю результат):
   - TLS: `curl -sI https://meet.tolkplace.ru | head -3` (HTTP 200), `echo | openssl s_client -connect meet.tolkplace.ru:443 -servername meet.tolkplace.ru 2>/dev/null | openssl x509 -noout -issuer -dates` (издатель Let's Encrypt, срок действия).
   - Конфиг клиента: `curl -s https://meet.tolkplace.ru/config.js | grep -E "domain|muc|focus|p2p"` — домены `meet.tolkplace.ru`, `conference.meet.tolkplace.ru`, `focus.meet.tolkplace.ru`, `enabled` для p2p включён.
   - Prosody: `docker compose exec prosody grep -n -E "VirtualHost|authentication" /config/prosody.cfg.lua` — анонимная аутентификация на основном VirtualHost.
   - Firewall: снаружи открыты только 80, 443, 10000/UDP (проверка с моей стороны и по настройкам группы); SSH только с вашего IP.
   - Логи: `docker compose logs --since 10m | grep -i -E "error|warn" | head`.
9. Монитор: `vm_load_monitor.sh` в отдельном `tmux`, пишет `load_log.csv` раз в 5 с (нужен `bc`, поставлен в шаге 1).

### 5.3 ASR-ВМ (`tolk-asr`)

Подробно в `asr-service/README.md`. Коротко:

1. Docker: `curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER`.
2. С вашего компьютера: `scp -r asr-service ubuntu@<ip-asr>:~/` (папка в репозитории, ветка `feat/asr-service-03-10`; репозиторий приватный, поэтому копируем напрямую, без `git clone` на ВМ).
3. На ВМ: `cd ~/asr-service && cp .env.example .env`, вписать `ASR_SERVICE_TOKEN=$(openssl rand -hex 32)` и остальное из п. 4.
4. `docker compose up -d --build` (10–15 минут; при первом старте скачиваются веса GigaAM).
5. `docker compose logs -f asr` до загрузки модели; `curl https://asr.tolkplace.ru/healthz` → `"model_loaded": true`.
6. `./smoke_test.sh https://asr.tolkplace.ru <токен>`: четыре проверки (health, 401 без токена, 401 с неверным, 200 с токеном).
7. Зафиксировать `GIGAAM_REF` на конкретный коммит.

Не проверено до первого запуска: сборка Docker-образа и загрузка весов (в моём окружении закрыт доступ к CDN весов). Контракт, нарезка и авторизация покрыты 11 тестами с подставным движком.

## 6. Порядок включения

1. Вы: п. 5.1. Я: смержу ветку `feat/asr-service-03-10` в `main` после вашего ОК (она не влияет на сборку Vercel).
2. Поднимаем Jitsi (5.2) и проверяем TLS, firewall, конфиг, логи.
3. Vercel шаг A (`NEXT_PUBLIC_JITSI_DOMAIN`) + Redeploy production. Проверяю, что клиент теперь идёт на `meet.tolkplace.ru`.
4. E2E 1: реальный звонок психолог и клиент по invite-ссылке, consent, звук в обе стороны, две дорожки записи. Проверка storage, chunks, manifest, job (должна быть `pending`).
5. Поднимаем ASR (5.3) и проходим smoke-тест.
6. Vercel шаг B (env ASR + `CRON_SECRET`) + Redeploy production.
7. Ручной запуск воркера, один раз за раз (запускаете вы, секрет в чат не присылаете): PowerShell `curl.exe -X POST https://tolk-three.vercel.app/api/jobs/process -H "Authorization: Bearer <CRON_SECRET>"`. Не запускать воркер до шага 6: иначе задача перейдёт в `blocked` и её придётся вручную возвращать в `pending`. Один вызов обрабатывает одну задачу (лимит 300 с).
8. Проверка транскрипта (`session_transcripts`, сегменты) и SOAP. E2E 2: две параллельные сессии с замером CPU, RAM, диска, сети и качества связи на обеих ВМ.
9. Отчёт и рекомендация по Promote. До этого момента ничего на `tolkplace.ru` не Promote-ится, Vercel Cron не включается.

## 7. Что именно включено в первом прогоне

- Jitsi: анонимный вход (`ENABLE_AUTH=0`), JWT не проверяется. Комнаты защищены неугадываемым именем из UUID сессии. JWT-enforced режим требует правок Prosody и обоих клиентских подключений и вынесен на отдельный этап после E2E.
- Запись, очередь, ASR, SOAP: реальные, без mock (`RECORDING_ASR_ADAPTER=http`).
- Cron: выключен; воркер запускается вручную защищённым вызовом с `CRON_SECRET`.
- `ENABLE_P2P`: штатное значение (true); false только для отдельного worst-case теста.
