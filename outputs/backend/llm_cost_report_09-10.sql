-- Отчёт по стоимости запросов ассистента: ОДИН запрос, ТОЛЬКО ЧТЕНИЕ (select), текстов сообщений в таблице нет.
-- Вставить целиком в Supabase SQL Editor боевого проекта, нажать Run, скопировать единственную ячейку результата (json).
-- Граница "после сжатия промпта": 2026-09-24 20:00 по Москве (мерж cost-optimization-24-09).
with r as (
  select request_id, min(created_at) as ts, max(route) as route, sum(cost_rub) as cost,
         max(llm_calls_count) as llm_calls, max(tool_calls_count) as tool_calls, max(retries_count) as retries,
         (array_agg(workflow_success order by created_at desc) filter (where workflow_success is not null))[1] as ok
  from llm_usage_log group by request_id
),
cut as (select timestamptz '2026-09-24 20:00+03' as t)
select jsonb_pretty(jsonb_build_object(
 'summary', (select coalesce(jsonb_agg(x order by x->>'after', x->>'route'),'[]') from (
    select jsonb_build_object('after',(ts >= (select t from cut)),'route',route,'requests',count(*),
      'avg_rub',round(avg(cost),2),'median_rub',round((percentile_cont(0.5) within group (order by cost))::numeric,2),
      'p90_rub',round((percentile_cont(0.9) within group (order by cost))::numeric,2),'max_rub',round(max(cost),2),'total_rub',round(sum(cost),1)) x
    from r group by (ts >= (select t from cut)), route) s),
 'by_tool_calls_after', (select coalesce(jsonb_agg(x order by (x->>'tool_calls_cap4')::int),'[]') from (
    select jsonb_build_object('tool_calls_cap4',least(tool_calls,4),'requests',count(*),'avg_llm_calls',round(avg(llm_calls),1),
      'avg_rub',round(avg(cost),2),'total_rub',round(sum(cost),1)) x
    from r where ts >= (select t from cut) group by least(tool_calls,4)) s),
 'per_llm_call_after_agentic', (select jsonb_build_object('llm_rows',count(*),'input_avg',round(avg(input_tokens)),'output_avg',round(avg(output_tokens)),
      'schema_est',round(avg(schema_tokens)),'history_est',round(avg(history_tokens)),'rag_est',round(avg(rag_tokens)),
      'total_avg',round(avg(total_tokens)),'rub_per_call',round(avg(cost_rub),2))
    from llm_usage_log where created_at >= (select t from cut) and coalesce(route,'agentic')='agentic'),
 'waste_after', (select coalesce(jsonb_agg(x),'[]') from (
    select jsonb_build_object('had_retries',(retries>0),'workflow_ok',coalesce(ok::text,'null'),'requests',count(*),
      'total_rub',round(sum(cost),1),'avg_rub',round(avg(cost),2)) x
    from r where ts >= (select t from cut) group by (retries>0), ok) s),
 'by_model_14d', (select coalesce(jsonb_agg(x),'[]') from (
    select jsonb_build_object('model',model,'llm_calls',count(*),'total_rub',round(sum(cost_rub),1),'avg_rub',round(avg(cost_rub),2)) x
    from llm_usage_log where created_at >= now() - interval '14 days' group by model) s),
 'by_day_14d', (select coalesce(jsonb_agg(x order by x->>'day'),'[]') from (
    select jsonb_build_object('day',((created_at at time zone 'Europe/Moscow')::date)::text,'requests',count(distinct request_id),'total_rub',round(sum(cost_rub),1)) x
    from llm_usage_log where created_at >= now() - interval '14 days' group by (created_at at time zone 'Europe/Moscow')::date) s)
)) as report;
