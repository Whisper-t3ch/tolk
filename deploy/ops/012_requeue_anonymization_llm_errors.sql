-- Записи, остановленные из-за временного сбоя LLM-обезличивания (429/5xx), ставим в очередь заново:
-- сырая запись сохранена, воркер (cron каждую минуту) обработает их по новой.
with q as (
  update public.recording_jobs
     set status = 'pending', locked_at = null, locked_by = null, attempts_count = 0, updated_at = now()
   where status = 'manual_review_required' and last_error like 'anonymization_llm_error%'
   returning session_id
)
update public.sessions s
   set recording_status = 'processing', transcript_error = null
  from q where s.id = q.session_id;
select 'requeued: ' || count(*) as result from public.recording_jobs where status = 'pending';
