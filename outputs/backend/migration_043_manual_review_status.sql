-- ============================================================
-- Migration 043 (04.10.2026): статус manual_review_required.
--
-- Зачем: если анонимизация текста сессии не удалась или модерация
-- YandexGPT отклонила запрос, сырой текст дальше НЕ идёт, а запись/задача
-- получает понятный статус «нужна ручная работа» вместо молчаливого сбоя.
--
-- ТОЛЬКО расширение допустимых значений CHECK-ограничений (существующие
-- значения и данные не меняются). Применять ДО деплоя кода этой ветки:
-- код пишет новое значение, и без миграции UPDATE упадёт на CHECK.
--
-- Откат: вернуть прежние списки значений (после того как в таблицах не
-- останется строк с manual_review_required).
-- ============================================================

-- 1) sessions.recording_status (видит психолог на странице протокола)
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_recording_status_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_recording_status_check
  CHECK (recording_status = ANY (ARRAY[
    'none', 'recording', 'uploading', 'processing', 'ready', 'failed',
    'incomplete', 'stopped_by_client', 'manual_review_required'
  ]));

-- 2) recording_jobs.status (очередь транскрипции)
ALTER TABLE recording_jobs DROP CONSTRAINT IF EXISTS recording_jobs_status_check;
ALTER TABLE recording_jobs ADD CONSTRAINT recording_jobs_status_check
  CHECK (status = ANY (ARRAY[
    'pending', 'processing', 'completed', 'failed', 'blocked', 'manual_review_required'
  ]));

-- 3) soap_generation_jobs.status (генерация черновика протокола)
ALTER TABLE soap_generation_jobs DROP CONSTRAINT IF EXISTS soap_generation_jobs_status_check;
ALTER TABLE soap_generation_jobs ADD CONSTRAINT soap_generation_jobs_status_check
  CHECK (status = ANY (ARRAY['pending', 'done', 'error', 'manual_review_required']));
