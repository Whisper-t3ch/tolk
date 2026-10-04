# Фронтенд ТОЛК в Docker рядом с ASR (staging-тест)

Цель: проверить, выдерживает ли **текущая ASR-ВМ (8 vCPU / 16 ГБ)** совместную нагрузку «сайт + ASR». Это НЕ переключение боевого домена.
Не включает: отдельную frontend-ВМ, Serverless Containers, размещение на Jitsi-ВМ, смену DNS `tolkplace.ru`, cron, JWT, Promote.

## Что в ветке
| Файл | Назначение |
|---|---|
| `Dockerfile`, `.dockerignore` (корень) | Многостадийная сборка Next.js standalone (Node 22). Vercel их не использует. |
| `next.config.ts` | `output: "standalone"` только при `NEXT_OUTPUT=standalone` (в Docker). Vercel-сборка не меняется. |
| `src/app/api/health/route.ts`, `src/middleware.ts` | `/api/health` — живость без БД и секретов; открыт без логина. |
| `deploy/frontend/docker-compose.frontend.yml` | Сервис `web` + подмена Caddyfile. ASR-контейнер не меняется. Лимиты web: 2 CPU, 3 ГБ. |
| `deploy/frontend/Caddyfile.combined` | `asr.tolkplace.ru` → ASR (как раньше); `FRONTEND_DOMAINS` → Next.js. Сейчас только `stage.tolkplace.ru`. |
| `deploy/frontend/frontend.sh` | build / up / status / logs / rollback / stop. |
| `deploy/frontend/monitor_stack.sh`, `evaluate_criteria.py` | Сбор метрик и автоматическая оценка критериев. |
| `deploy/availability/check_availability.{ps1,sh}` | Тест доступности без VPN, **теперь с Supabase** (REST/Auth/Storage + POST 2 МБ) и staging. |

Проверено локально (без Docker, его на машине нет): `next build` со `NEXT_OUTPUT=standalone` проходит, `node server.js` стартует, `/api/health` 200, `/login` 200, `/dashboard` → 307 на `/login`. **Сам `docker build` и Caddy-конфиг на ВМ не прогонялись** — первая проверка будет на ВМ.

## Раскладка на ВМ
```
~/asr-service/                 существующий ASR (docker-compose.yml, Caddyfile, .env) — не трогаем
  + docker-compose.frontend.yml, Caddyfile.combined, frontend.sh, monitor_stack.sh, evaluate_criteria.py  (копия из deploy/frontend)
  + .env.frontend              заполняет владелец (шаблон env.frontend.example), chmod 600
~/tolk-src/                    снимок исходников (git archive), содержит Dockerfile
```

## Порядок запуска (когда назначим окно; сейчас ничего не выполняется)
0. DNS: A-запись `stage.tolkplace.ru` → 51.250.92.52 (только staging; основной `tolkplace.ru` не трогаем).
1. Supabase Auth → URL Configuration: добавить `https://stage.tolkplace.ru/**` в Redirect URLs (основные не удалять).
2. На ПК (PowerShell, из корня репозитория, ветка infra): `git archive --format=tar.gz -o tolk-src.tgz HEAD` и `scp` архива и файлов `deploy/frontend/*` на ВМ. Отдельно запомнить `git rev-parse HEAD`.
3. На ВМ: `mkdir -p ~/tolk-src && tar -xzf tolk-src.tgz -C ~/tolk-src`; записать хэш коммита: `echo <хэш> > ~/tolk-src/.git_commit` (попадёт в `/api/health`); скопировать файлы deploy/frontend в `~/asr-service`; `cp env.frontend.example .env.frontend`, заполнить, `chmod 600 .env.frontend`; `chmod +x frontend.sh monitor_stack.sh`.
4. Сборка в тихий момент (она грузит CPU): `./frontend.sh build`. Затем `./frontend.sh up`; Caddy пересоздаётся — `asr.tolkplace.ru` недоступен несколько секунд.
5. `./frontend.sh status` → web healthy, `https://stage.tolkplace.ru/api/health` = `{"ok":true,…}`.

### Шрифты при сборке
`next/font/google` скачивает Inter/Manrope **во время сборки** (в рантайме сайт отдаёт их сам). `frontend.sh build` проверяет доступ к fonts.googleapis.com и останавливается, если его нет. Тогда варианты: собрать образ на другой машине, либо отдельной правкой перейти на `next/font/local` (избавит и от зависимости сборки, и от внешних запросов; сейчас не делалось).

## Откат
- Откат версии: `./frontend.sh rollback` (возвращает `tolk-web:previous`).
- Остановить фронтенд: `./frontend.sh stop` (ASR не затрагивается).
- Полностью убрать: `cp asr-service/Caddyfile Caddyfile` и `docker compose -f docker-compose.yml up -d --no-deps caddy` (базовый compose без override) — ASR остаётся как был.
- Публичный DNS `tolkplace.ru` в этом тесте не меняется, поэтому для пользователей откат не нужен.

## Переключение основного домена (ОТДЕЛЬНОЕ решение, не сейчас)
Только после прохождения критериев, замеров из РФ и вашего «да»: добавить `tolkplace.ru www.tolkplace.ru` в `FRONTEND_DOMAINS`, `NEXT_PUBLIC_APP_URL=https://tolkplace.ru`, пересобрать (URL вшивается в сборку), снизить TTL заранее, сменить A-запись. Откат — вернуть записи Vercel (TTL 300) и убрать домены из списка.

## Нагрузочный тест (окно с ВМ; сначала ваше подтверждение)
Сценарий: сайт + логин + запись + загрузка аудио + транскрибация + SOAP; затем 2 параллельные сессии и 4 живых участника.
1. Baseline ASR: один файл ~10 мин **при простаивающем сайте**, записать длину и время (`./monitor_stack.sh 5 stage.tolkplace.ru &`).
2. Под нагрузкой: те же файлы транскрибируются, пока идут логины/записи/SOAP на staging.
3. Остановить монитор. Время ASR-задач (end-to-end, включая сборку дорожек и анонимизацию):
```sql
select j.session_id, st.duration_seconds as audio_sec,
       extract(epoch from (j.updated_at - j.locked_at)) as job_sec
from recording_jobs j join session_transcripts st on st.session_id = j.session_id
where j.status = 'completed' and j.locked_at > '<начало теста>';
```
Сохранить как `asr_jobs.csv` (`phase,audio_sec,job_sec`, phase = baseline | loaded) и выполнить:
`python3 evaluate_criteria.py stack_metrics.csv --asr-jobs asr_jobs.csv`.
4. Ошибки/рестарты: `./frontend.sh status`, `docker compose logs --since 1h web caddy | grep -ci error`; 5xx в логах Caddy.

## Критерии «текущая ASR-ВМ не подходит» (зафиксированы ДО теста)
Срабатывание любого → сравниваем апгрейд ASR-ВМ, Serverless Containers и отдельную frontend-ВМ. Пороги — в начале `evaluate_criteria.py`; менять только до теста.

| № | Критерий | Порог |
|---|---|---|
| K1 | TTFB сайта (замер на ВМ: `/login`, `/api/health`) | p95 > 1.5 с, либо 3 подряд замера > 3 с |
| K2a | CPU ВМ **вне** окон работы ASR (контейнер asr < 100%) | rolling-5 мин ≥ 75% |
| K2b | Вытеснение в окнах ASR: load1 / число vCPU | rolling-5 мин > 1.25 |
| K3 | Доступная RAM / OOM | < 15% (2+ замера подряд) или любой OOM |
| K4 | Swap | > 256 МБ или прирост > 100 МБ |
| K5 | Рестарты контейнеров asr/web/caddy | любой |
| K6 | HTTP-ошибки на /login, /api/health | > 1% |
| K7 | Время ASR под нагрузкой к baseline (медиана job_sec/audio_sec) | рост > 30% |

Пояснение к CPU: GigaAM по дизайну занимает все 8 ядер на время транскрибации, поэтому «CPU > 75–80%» сам по себе в эти минуты нормален. Отдельно ловим реальные признаки вытеснения сайта: K1 (TTFB), K2b (очередь процессов) и K7 (замедление ASR). K2a ловит ситуацию, когда ядра занято чем-то помимо ASR.
Ограничение замеров: TTFB здесь снимается на самой ВМ (по loopback + TLS); внешний TTFB из РФ-сетей — отдельно скриптом `check_availability` и с мобильных сетей.

## Supabase и 152‑ФЗ
Перенос фронтенда в РФ **не решает** вопрос Supabase: браузер шлёт аудиочанки напрямую в Supabase Storage (eu-west-1), БД тоже там. Доступность Supabase из РФ без VPN и юридическая оценка — отдельные пункты; для первого теперь есть проверка в `check_availability`.
