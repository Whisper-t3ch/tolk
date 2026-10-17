# GigaChat на stage + тестовые данные (14-15.10.2026)

Нужен ssh на core2 (37.139.35.119) с разрешённого IP. Секреты в чат не присылать.

## 1. Отправить код на core2 (PowerShell, из папки проекта)
```
tar -czf $env:TEMP\llm_patch.tgz src/lib/llm src/lib/yandexgpt.ts deploy/core
scp $env:TEMP\llm_patch.tgz ubuntu@37.139.35.119:~/
```

## 2. Распаковать и собрать (по ssh на core2)
```
ssh ubuntu@37.139.35.119
cd ~/tolk-src && tar -xzf ~/llm_patch.tgz src
tar -xzf ~/llm_patch.tgz -C ~/core --strip-components=2 deploy/core
cd ~/core && sed -i 's/\r$//' *.sh && chmod +x *.sh
./core.sh build
```

## 3. Включить GigaChat (спросит ключ, ввод скрытый)
```
./llm_stage.sh on GigaChat-2-Pro
./llm_stage.sh status
```
Опционально вторая модель для «лёгких» шагов: `./llm_stage.sh on GigaChat-2-Pro GigaChat-2` (по тестам GigaChat-2 слаб в выборе инструментов, для первого теста не включаем).
Вернуть Яндекс: `./llm_stage.sh off`.

## 4. Тестовые данные (после входа на stage хотя бы раз)
```
./seed_test_data.sh <email психолога, под которым входите на stage>
```
Создаёт Анну Тестову, Игоря Образцова, Марину Пример с сессиями и заметками (завтра по две сессии). Убрать: `./seed_test_data.sh <email> --clean`.

## Ограничения
- `search_client_history` на stage не заработает (эмбеддинги на Yandex, ключа нет): сценарий 4 оценивать отдельно.
- Если в логах `docker logs core-web-1` ошибки TLS до Сбера, добавьте подчинённый сертификат (gosuslugi.ru/crt) в `~/core/certs/ru-ca.pem` и сделайте `./core.sh restart-web`.
