-- ============================================================
-- migration_033_llm_usage_log_rls_fix.sql
--
-- Исправление migration_032: таблица llm_usage_log была создана с
-- enable row level security, но БЕЗ единой policy — это блокирует
-- ЛЮБОЙ insert, включая тот, что и должен был писать данные:
-- route.ts (/api/assistant) использует обычный авторизованный
-- Supabase-клиент (NEXT_PUBLIC_SUPABASE_ANON_KEY через createClient()
-- из lib/supabase/server.ts), а не service-role — то есть пишущая
-- сторона сама подпадает под RLS. Комментарий в migration_032 ошибочно
-- предполагал, что запись будет идти от service-role скрипта; на
-- деле она идёт от обычной сессии психолога.
--
-- Найдено 20.09: после деплоя логирования 0 строк появилось в таблице
-- при том что HTTP-ответы психологу были нормальными (insert
-- проваливался тихо для психолога — logLlmUsage() глушит ошибку через
-- console.error, не роняя основной ответ — но и не появлялся в БД).
--
-- Policy: authenticated может INSERT только строку СО СВОИМ
-- psychologist_id (auth.uid()) — тот же паттерн, что и у обычных
-- пользовательских таблиц вроде agent_sessions. SELECT не открываем
-- обычным психологам (это агрегированная аналитика по всем
-- психологам, не персональная лента конкретного психолога) — только
-- service-role видит все строки для биллинг-анализа.
--
-- Применять через Supabase SQL Editor. Идемпотентно.
-- ============================================================

drop policy if exists llm_usage_log_insert_own on llm_usage_log;
create policy llm_usage_log_insert_own
  on llm_usage_log
  for insert
  to authenticated
  with check (psychologist_id = auth.uid());
