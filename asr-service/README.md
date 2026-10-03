# ТОЛК ASR-сервис (GigaAM на CPU)

Принимает аудиодорожку по контракту `createHttpAsrAdapter` (`src/lib/recording/asrAdapter.ts`) и возвращает транскрипт с таймкодами.

- `POST /transcribe_track` — multipart: `track` (`psychologist` | `client`), `audio` (webm/ogg/mp4/wav). Заголовок `Authorization: Bearer <ASR_SERVICE_TOKEN>`.
- Ответ: `{ text, duration_seconds, segments: [{start_ms, end_ms, text}], model, processing_seconds, track }`.
- `GET /healthz` — без авторизации.
- Модель по умолчанию `v3_e2e_ctc` (пунктуация и нормализация текста). Дорожка режется по самым тихим местам на отрезки до 24 с (GigaAM принимает до ~25 с), полностью тихие отрезки пропускаются. Pyannote и токен HuggingFace не нужны.
- Без `ASR_SERVICE_TOKEN` (или короче 16 символов) сервис не стартует. Снаружи доступен только Caddy (80/443); порт 8000 контейнера наружу не публикуется. Caddy дополнительно отсекает запросы без токена до сервиса.

## Тесты (без модели)

```bash
pip install fastapi uvicorn python-multipart numpy httpx pytest   # нужен ffmpeg
python -m pytest -q
```

## Запуск на ASR-ВМ

1. Ubuntu 22.04: `curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER` (перелогиниться).
2. Скопировать папку с вашего компьютера: `scp -r asr-service <user>@<ASR_IP>:~/`.
3. На ВМ: `cd ~/asr-service && cp .env.example .env`, сгенерировать токен `openssl rand -hex 32`, вписать в `.env` (`ASR_SERVICE_TOKEN`, `ASR_DOMAIN`, `TORCH_THREADS` = число vCPU).
4. `docker compose up -d --build`. Первая сборка — 10–15 минут; при первом старте контейнер скачивает веса GigaAM (кэш в томе `gigaam-cache`).
5. `docker compose logs -f asr` — дождаться загрузки модели; `curl https://asr.tolkplace.ru/healthz` должен показать `"model_loaded": true`. Сертификат Let's Encrypt выпускается Caddy автоматически, DNS-запись `asr.tolkplace.ru` должна к этому моменту уже указывать на IP ВМ.
6. `./smoke_test.sh https://asr.tolkplace.ru <токен>` — четыре проверки (health, 401 без токена, 401 с неверным, 200 с токеном).
7. После первой успешной сборки зафиксировать `GIGAAM_REF` на конкретный коммит (`git ls-remote https://github.com/salute-developers/GigaAM HEAD`).

Не проверено на момент написания: сборка Docker-образа и загрузка весов (в окружении разработки закрыт доступ к CDN весов); контракт, нарезка и авторизация покрыты тестами с подставным движком.
