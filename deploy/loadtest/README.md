# Нагрузочные тесты ASR-ВМ (Supabase + сайт + ASR)

Запуск НА ВМ. Файлы копируются в `~/loadtest/`. Нужен образец аудио (ogg/webm/wav, ~10 мин) и работающие `~/asr-service` (monitor_stack.sh, evaluate_criteria.py) и `~/supabase`.

- `asr_bench.sh <phase> <audio> [count] [parallel]` — замер ASR (baseline / loaded / burst). Токен из `~/asr-service/.env`, не печатается.
- `supabase_load.py --users N --minutes M [--speed X]` — N психологов одновременно пишут сессию (2 дорожки, чанк ~90 КБ каждые 20 с, REST-чтения). Создаёт и удаляет тестовых пользователей `load+*@example.com` и файлы `load/` в бакете. Остатки после обрыва: `python3 supabase_load.py --purge`.
- `run_load.sh <audio> [users=20] [minutes=12] [speed=1]` — всё вместе: тишина → ASR baseline → нагрузка + ASR loaded → burst (4 ASR-задачи сразу) + оценка K1–K7 + CPU контейнеров Supabase.

Сценарии: `20 12 1` (бета: все 20 психологов пишут одновременно — это пик, на практике ниже), `50 12 1`, `100 12 1`; предел — `100 12 5` (в 5 раз чаще). Каждый прогон — отдельно, между ними пауза 2–3 мин.

Ограничения: генератор нагрузки работает на той же ВМ (его CPU мал, но не нулевой); не моделируются запись транскрипта, вызовы YandexGPT и Jitsi. Jitsi — отдельным тестом (другая ВМ).
