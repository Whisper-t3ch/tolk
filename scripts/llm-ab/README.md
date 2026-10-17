# Сравнение LLM через Cloud.ru (GigaChat и др.)

Проверка, как модели справляются с задачами ТОЛК: выбор инструмента, ответ по данным
инструмента, отказ от лишних вызовов, строгий JSON. Все данные синтетические.

## Запуск (PowerShell, из папки репозитория)

```
cd scripts\llm-ab
$env:LLM_API_KEY = "<ключ Cloud.ru>"     # вводите сами, в чат не присылайте
node probe.mjs models                      # точные имена моделей, доступных ключу
node probe.mjs smoke --models "<имя GigaChat>"
node probe.mjs run --models "<GigaChat>,<DeepSeek V4.1 Flash>,<GLM 5.2>" --repeat 3
```

Результат: таблица (доля пройденных кейсов по типам, задержка p50/p95, токены,
оценка ₽ за 1000 запросов) и список провалов; сырые ответы в `out/` (в git не попадает).

## Включение в приложении (stage/тест, не прод)

```
LLM_PROVIDER=openai_compat
LLM_API_KEY=<ключ>
LLM_MODEL_PRO=<имя модели>
LLM_MODEL_LITE=<имя модели> (необязательно)
```

Без `LLM_PROVIDER` всё работает на YandexGPT. Ограничения: эмбеддинги остаются на Yandex
(в БД `vector(256)`), SOAP «async» эмулируется в памяти процесса.

## GigaChat от Сбера (личный кабинет developers.sber.ru, тестовый доступ)

Формат функций у Сбера свой (`functions` / `function_call`, роль `function`), токен живёт 30 минут
и получается через OAuth по «Authorization key». Скрипт и адаптер делают это сами.
Серверы Сбера используют сертификаты Минцифры: без них Node не установит TLS.

```
# один раз: корневой сертификат Минцифры
Invoke-WebRequest https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt -OutFile $env:USERPROFILE\russian_root_ca.pem

cd scripts\llm-ab
$env:NODE_EXTRA_CA_CERTS = "$env:USERPROFILE\russian_root_ca.pem"
$env:LLM_DIALECT = "gigachat"
$env:LLM_AUTH = "gigachat_oauth"
$env:LLM_API_KEY = "<Authorization key из кабинета>"   # вводите сами, в чат не присылайте
node probe.mjs models
node probe.mjs smoke --models "GigaChat-2-Max"
node probe.mjs run --models "GigaChat-2,GigaChat-2-Pro,GigaChat-2-Max,GigaChat-3-Ultra" --repeat 3
```

Если будет ошибка «unable to verify the first certificate», добавьте в тот же .pem подчинённый
сертификат Минцифры (https://www.gosuslugi.ru/crt). Scope по умолчанию `GIGACHAT_API_PERS`
(физлица, бесплатные токены); для коммерческого использования нужен корпоративный доступ
(`GIGACHAT_API_B2B` / `GIGACHAT_API_CORP`, меняется через `LLM_OAUTH_SCOPE`).

В приложении (stage): те же `LLM_DIALECT`, `LLM_AUTH`, `LLM_API_KEY`, `NODE_EXTRA_CA_CERTS` (путь к
сертификату внутри контейнера) плюс `LLM_PROVIDER=openai_compat` и `LLM_MODEL_PRO`.
