# Деплой видео + ASR на ВМ (Jitsi + Jibri + GigaAM)

Инструкция для развёртывания на купленной ВМ (16 vCPU / 32 GB RAM / 50 GB SSD,
Ubuntu 22.04 LTS). Проходить по шагам последовательно — каждый следующий раздел
предполагает, что предыдущий уже работает.

Код платформы (Vercel) уже готов принимать реальные `video_room_url` и записи —
единственное, чего не хватает, это самой инфраструктуры и трёх переменных
окружения в Vercel (см. раздел 5).

---

## 0. Что нужно заранее

- Домен (или поддомен), например `call.tolk.pro`, с A-записью на публичный IP ВМ.
- SSH-доступ к ВМ.
- ~15-20 минут на каждый этап + ожидание выпуска TLS-сертификата.

---

## 1. Jitsi Meet + Jibri (запись звонков)

Официальный способ — `docker-jitsi-meet` (репозиторий `jitsi/docker-jitsi-meet`
на GitHub). Он сам поднимает все внутренние сервисы (Prosody, Jicofo, JVB, web)
и умеет докручиваться до Jibri отдельным compose-файлом.

```bash
# Docker + Docker Compose, если их ещё нет
curl -fsSL https://get.docker.com | sh
sudo apt install -y docker-compose-plugin

git clone https://github.com/jitsi/docker-jitsi-meet.git
cd docker-jitsi-meet
cp env.example .env

# КРИТИЧЕСКИ ВАЖНО: сгенерировать пароли перед первым запуском —
# дефолтные/пустые пароли Jicofo/JVB/Prosody/Jibri оставляют
# инстанс открытым для абьюза
./gen-passwords.sh

mkdir -p ~/.jitsi-meet-cfg/{web,transcripts,prosody/config,prosody/prosody-plugins-custom,jicofo,jvb,jigasi,jibri}
```

В `.env` задать минимум:

```
PUBLIC_URL=https://call.tolk.pro
DOCKER_HOST_ADDRESS=<публичный IP ВМ>
```

Запуск базового стека:

```bash
docker compose up -d
```

Проверка: открыть `https://call.tolk.pro` в браузере (пока без TLS будет
предупреждение — сертификат настраивается на шаге 1.2).

### 1.1 Jibri (запись)

Jibri требует Chrome + FFmpeg внутри своего контейнера (уже в официальном
образе) и модуль ядра `snd_aloop` на хосте — это единственная часть, которая
не переезжает в контейнер:

```bash
sudo modprobe snd-aloop
echo "snd-aloop" | sudo tee -a /etc/modules
```

В `.env` включить Jibri:

```
ENABLE_RECORDING=1
JIBRI_RECORDER_USER=recorder
JIBRI_RECORDER_PASSWORD=<из gen-passwords.sh>
```

Запуск с Jibri:

```bash
docker compose -f docker-compose.yml -f jibri.yml up -d
```

Jibri пишет готовые записи в `~/.jitsi-meet-cfg/transcripts` (несмотря на
название папки — там лежат `.mp4`, само название унаследовано от старого
дефолтного finalize-скрипта Jitsi).

Ресурсы: закладывайте отдельно ~4 GB RAM на Jibri поверх обычного JVB —
на 16 vCPU/32 GB это не проблема, но держите в уме при планировании
одновременных 15-20 записываемых звонков (тест под нагрузкой — см. раздел 4).

### 1.2 TLS

Проще всего — Let's Encrypt через встроенный скрипт:

```bash
./gen-letsencrypt-cert.sh
```

(интерактивно спросит домен и email; для автопродления добавить `certbot renew`
в cron, если скрипт сам не поставил таймер).

### 1.3 finalize-скрипт → webhook на платформу

По умолчанию Jibri после завершения записи запускает
`/config/finalize.sh` (путь настраивается в `jibri.conf` внутри
`~/.jitsi-meet-cfg/jibri`). Нужно дописать в конец этого скрипта отправку
файла в наш webhook — платформа сама поставит сессию в очередь на
расшифровку (`POST /api/webhooks/recording`, код уже готов, см.
`src/app/api/webhooks/recording/route.ts`).

Пример `finalize.sh` (адаптировать под реальный способ раздачи файла —
ниже вариант с загрузкой в Supabase Storage, самый простой без доп. инфры):

```bash
#!/bin/bash
# $1 — путь к папке с готовой записью (Jibri передаёт это как аргумент)
RECORDING_DIR="$1"
RECORDING_FILE=$(find "$RECORDING_DIR" -name "*.mp4" | head -1)

# Имя комнаты Jitsi = tolk-{session_id} (см. src/lib/jitsi.ts) —
# session_id это то, что после "tolk-" в имени файла/папки.
ROOM_NAME=$(basename "$RECORDING_DIR")
SESSION_ID="${ROOM_NAME#tolk-}"

# Загружаем в Supabase Storage (bucket "recordings", создать заранее
# в Supabase Dashboard -> Storage, приватный bucket)
UPLOAD_URL=$(curl -s -X POST \
  "${SUPABASE_URL}/storage/v1/object/recordings/${SESSION_ID}.mp4" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: video/mp4" \
  --data-binary "@${RECORDING_FILE}" \
  -o /dev/null -w "%{http_code}")

RECORDING_PUBLIC_URL="${SUPABASE_URL}/storage/v1/object/sign/recordings/${SESSION_ID}.mp4"

curl -s -X POST "https://<ваш-домен-vercel>/api/webhooks/recording" \
  -H "Content-Type: application/json" \
  -H "X-Recording-Webhook-Secret: ${RECORDING_WEBHOOK_SECRET}" \
  -d "{\"session_id\": \"${SESSION_ID}\", \"recording_url\": \"${RECORDING_PUBLIC_URL}\"}"
```

Переменные `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RECORDING_WEBHOOK_SECRET`
прописать в окружении, откуда запускается Jibri-контейнер (`.env` этого
compose-стека) — они должны совпадать с тем, что задано в Vercel (шаг 5).

---

## 2. GigaAM (расшифровка)

GigaAM — это Python-библиотека (`salute-developers/GigaAM` на GitHub), а не
готовый HTTP-сервис "из коробки" — нужно обернуть её в простой веб-сервер.

### 2.1 Установка

```bash
sudo apt install -y python3.11 python3.11-venv ffmpeg
git clone https://github.com/salute-developers/GigaAM.git
cd GigaAM
python3.11 -m venv venv
source venv/bin/activate
pip install -e .[torch]

# Для расшифровки длинных записей (наши сессии — 50 минут, а .transcribe()
# работает только до 25 секунд за раз) нужен .transcribe_longform + pyannote:
pip install -e ".[longform]"
```

`.transcribe_longform` требует HuggingFace-токен с принятыми условиями
доступа к `pyannote/segmentation-3.0` (страница модели на huggingface.co —
там кнопка "Agree and access repository", один раз вручную).

### 2.2 Обёртка HTTP API

Контракт, который уже ожидает `src/lib/asr.ts` на стороне платформы:
`POST {ASR_SERVICE_URL}/transcribe`, body `{"audio_url": "..."}`, ответ
`{"text": "...", "duration_seconds": 123}`.

Минимальный сервис (`gigaam_service.py`, положить рядом с venv):

```python
import os
import tempfile
import urllib.request
from fastapi import FastAPI
from pydantic import BaseModel
import gigaam

app = FastAPI()
model = gigaam.load_model("v3_e2e_rnnt")  # поддерживает пунктуацию/нормализацию

class TranscribeRequest(BaseModel):
    audio_url: str

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/transcribe")
def transcribe(req: TranscribeRequest):
    with tempfile.NamedTemporaryFile(suffix=".mp4") as tmp:
        urllib.request.urlretrieve(req.audio_url, tmp.name)
        result = model.transcribe_longform(tmp.name)
        text = "\n".join(seg.text for seg in result)
        duration = result[-1].end if result else 0
    return {"text": text, "duration_seconds": duration}
```

```bash
pip install fastapi uvicorn
uvicorn gigaam_service:app --host 127.0.0.1 --port 8001
```

Держать сервис живым через systemd (пример unit-файла):

```ini
# /etc/systemd/system/gigaam.service
[Unit]
Description=GigaAM ASR service
After=network.target

[Service]
WorkingDirectory=/root/GigaAM
Environment="HF_TOKEN=<ваш huggingface токен>"
ExecStart=/root/GigaAM/venv/bin/uvicorn gigaam_service:app --host 127.0.0.1 --port 8001
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now gigaam
curl http://127.0.0.1:8001/health
```

Сервис слушает только `127.0.0.1` — наружу его выставлять не нужно, наш
webhook на платформе обращается к нему изнутри той же ВМ (если Vercel будет
дёргать его напрямую — тогда нужен reverse-proxy с TLS и авторизацией, но по
согласованной архитектуре ASR вызывается из `finalize.sh` на самой ВМ, а не
с Vercel, так что публичный доступ не требуется).

### 2.3 CPU vs GPU

GigaAM-v3 модели (220-600M параметров) реально крутить на CPU для нагрузки
15-20 сессий/день (не одновременно — расшифровка идёт постфактум, после
звонка, а не в реальном времени), но время обработки будет заметным
(минуты на 50-минутную запись). Если после первых тестов окажется медленно —
следующий шаг: GPU-инстанс или конвертация в ONNX (`model.to_onnx(...)`,
см. GigaAM README) для ускорения на CPU через onnxruntime.

---

## 3. Переменные окружения на ВМ

В окружении, откуда стартует Jibri-контейнер и systemd-сервис GigaAM:

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<из Supabase Dashboard -> Settings -> API>
RECORDING_WEBHOOK_SECRET=<сгенерировать случайную строку, например openssl rand -hex 32>
```

---

## 4. Нагрузочный тест перед бетой

Перед запуском 15-20 психологов одновременно:

1. Провести 3-5 параллельных тестовых звонков с записью (можно с телефонов
   разных людей/аккаунтов) — проверить, что видео/аудио не деградирует.
2. Проверить, что все записи доехали до `POST /api/webhooks/recording` и
   `sessions.recording_status` стал `ready` (SQL: `select recording_status,
   count(*) from sessions group by 1`).
3. Прогнать `curl -w "%{time_total}"` на `/transcribe` с реальной 10-минутной
   записью — понять, сколько реально занимает расшифровка, чтобы прикинуть
   очередь при пиковой нагрузке.
4. Задачи #9 из трекера (симулкаст, ограничение разрешения, bandwidth
   estimation) — настраиваются в `~/.jitsi-meet-cfg/jvb/jvb.conf` и
   `~/.jitsi-meet-cfg/web/rootconfig.js`, делать по факту после первого
   нагрузочного теста, если видно деградацию.

---

## 5. Переменные окружения в Vercel

После того как разделы 1-2 работают, добавить в Vercel (Settings -> Environment
Variables) и передеплоить:

```
NEXT_PUBLIC_JITSI_DOMAIN=call.tolk.pro
ASR_SERVICE_URL=<внутренний адрес, куда finalize.sh стучится — если GigaAM
  вызывается только с самой ВМ (см. 2.2), эта переменная нужна только если
  вы решите вызывать ASR напрямую с Vercel, а не из finalize.sh; в
  согласованной архитектуре можно оставить пустой>
RECORDING_WEBHOOK_SECRET=<то же значение, что и на ВМ в разделе 3>
```

`NEXT_PUBLIC_APP_URL` (уже упоминалась ранее в проекте, для Telegram-вебхуков)
тоже должна быть на реальном домене платформы к этому моменту.

Как только `NEXT_PUBLIC_JITSI_DOMAIN` появится в Vercel и будет передеплоено —
все ссылки на видеозвонки (`send_session_invite`, `/session/[id]`, список
сессий) автоматически станут рабочими без дополнительных правок кода.
