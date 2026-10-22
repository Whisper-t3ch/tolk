-- Демо-клиент «Демо: аналитика» с историей тестов (PHQ-9, GAD-7, WHO-5) и оценками состояния,
-- чтобы смотреть вкладку «Аналитика». Создаётся у аккаунтов владельца; удаляется обычным удалением клиента.
do $$
declare p record; cid uuid; made int := 0;
begin
  for p in select u.id from auth.users u where lower(u.email) in ('alejnikovanton182@gmail.com', 'tolkplace@gmail.com') loop
    continue when exists (select 1 from public.clients where psychologist_id = p.id and name = 'Демо: аналитика');
    insert into public.clients (psychologist_id, name, request, approach, status, gender)
      values (p.id, 'Демо: аналитика', 'Тревога и сниженное настроение (демонстрационные данные)', 'cbt', 'active', 'female')
      returning id into cid;

    insert into public.test_results (client_id, psychologist_id, test_type, score, max_score, interpretation, status, created_at) values
      (cid, p.id, 'PHQ9', 18, 27, 'Умеренно тяжёлая депрессия', 'completed', now() - interval '35 days'),
      (cid, p.id, 'PHQ9', 15, 27, 'Умеренно тяжёлая депрессия', 'completed', now() - interval '28 days'),
      (cid, p.id, 'PHQ9', 11, 27, 'Умеренная депрессия',          'completed', now() - interval '14 days'),
      (cid, p.id, 'PHQ9',  8, 27, 'Лёгкая депрессия',             'completed', now() - interval '2 days'),
      (cid, p.id, 'GAD7', 14, 21, 'Умеренная тревожность',        'completed', now() - interval '35 days'),
      (cid, p.id, 'GAD7', 11, 21, 'Умеренная тревожность',        'completed', now() - interval '21 days'),
      (cid, p.id, 'GAD7',  8, 21, 'Лёгкая тревожность',           'completed', now() - interval '7 days'),
      (cid, p.id, 'GAD7',  6, 21, 'Лёгкая тревожность',           'completed', now() - interval '2 days'),
      (cid, p.id, 'WHO5', 28, 100, 'Низкое благополучие — риск депрессии, рекомендован скрининг', 'completed', now() - interval '35 days'),
      (cid, p.id, 'WHO5', 40, 100, 'Сниженное благополучие',      'completed', now() - interval '14 days'),
      (cid, p.id, 'WHO5', 52, 100, 'Хорошее благополучие',        'completed', now() - interval '2 days');

    insert into public.client_progress (client_id, psychologist_id, metric_type, value, note, recorded_at) values
      (cid, p.id, 'general', 3, 'Начало работы, высокая тревога', now() - interval '35 days'),
      (cid, p.id, 'general', 4, null,                              now() - interval '28 days'),
      (cid, p.id, 'general', 5, 'Освоила дыхательную технику',     now() - interval '21 days'),
      (cid, p.id, 'general', 5, null,                              now() - interval '14 days'),
      (cid, p.id, 'general', 6, 'Вернулась к прогулкам',           now() - interval '7 days'),
      (cid, p.id, 'general', 7, 'Стабильно лучше, меньше ночных пробуждений', now() - interval '2 days');
    made := made + 1;
  end loop;
  raise notice 'демо-клиент создан для аккаунтов: %', made;
end $$;
select 'demo analytics: ok' as result;
