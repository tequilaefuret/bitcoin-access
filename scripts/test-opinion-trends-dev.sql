-- Transactional Stage 3 smoke test. Every row and queue job is rolled back.
begin;

do $$
declare
  test_as_of timestamptz := now();
  test_author text;
  target_topic_id uuid;
  first_message_id uuid;
  second_message_id uuid;
  duplicate_message_id uuid;
  repost_message_id uuid;
  one_hour_row record;
  trend_row record;
begin
  select balance.bitcoin_address
  into test_author
  from public.user_balances as balance
  order by balance.bitcoin_address
  limit 1;

  if test_author is null then
    raise exception 'Trend smoke test requires at least one DEV user balance';
  end if;

  select topic.id
  into target_topic_id
  from public.opinion_topics as topic
  where topic.slug = 'nuclear-power'
    and topic.status = 'active';

  update public.opinion_trend_window_settings
  set
    hot_min_authors = 1,
    hot_min_root_threads = 1,
    hot_min_messages = 2,
    hot_min_voters = 1,
    target_authors = 2,
    target_root_threads = 2,
    target_messages = 3,
    target_voters = 2
  where window_minutes = 60;

  insert into public.messages (
    bitcoin_address,
    content,
    char_count,
    cost_shells,
    created_at,
    content_origin
  )
  values (
    test_author,
    'Le parc nucleaire existant peut limiter le recours aux centrales fossiles.',
    72,
    0,
    test_as_of - interval '30 minutes',
    'human'
  )
  returning id into first_message_id;

  insert into public.messages (
    bitcoin_address,
    content,
    char_count,
    cost_shells,
    created_at,
    content_origin
  )
  values (
    test_author,
    'Les couts de construction doivent etre compares aux emissions evitees.',
    69,
    0,
    test_as_of - interval '20 minutes',
    'human'
  )
  returning id into second_message_id;

  insert into public.messages (
    bitcoin_address,
    content,
    char_count,
    cost_shells,
    created_at,
    content_origin
  )
  values (
    test_author,
    '  LE PARC nucleaire existant peut limiter le recours aux centrales fossiles.  ',
    76,
    0,
    test_as_of - interval '10 minutes',
    'human'
  )
  returning id into duplicate_message_id;

  insert into public.messages (
    bitcoin_address,
    content,
    char_count,
    cost_shells,
    created_at,
    content_origin,
    repost_of
  )
  values (
    test_author,
    'Le parc nucleaire existant peut limiter le recours aux centrales fossiles.',
    72,
    0,
    test_as_of - interval '5 minutes',
    'human',
    first_message_id
  )
  returning id into repost_message_id;

  insert into public.opinion_message_topic_scores (
    message_id,
    topic_id,
    relevance_score,
    accepted,
    is_primary,
    embedding_model
  )
  values
    (first_message_id, target_topic_id, 0.90, true, true, 'trend-smoke-test'),
    (second_message_id, target_topic_id, 0.90, true, true, 'trend-smoke-test'),
    (duplicate_message_id, target_topic_id, 0.90, true, true, 'trend-smoke-test'),
    (repost_message_id, target_topic_id, 0.90, true, true, 'trend-smoke-test');

  insert into public.message_useful_votes (
    message_id,
    bitcoin_address,
    created_at
  )
  values (
    first_message_id,
    test_author,
    test_as_of - interval '2 minutes'
  );

  perform public.refresh_opinion_trends(test_as_of);

  select trend_window.*
  into one_hour_row
  from public.opinion_topic_trend_windows as trend_window
  where trend_window.topic_id = target_topic_id
    and trend_window.window_minutes = 60;

  if one_hour_row.message_count <> 2
    or one_hour_row.root_thread_count <> 2
    or one_hour_row.distinct_author_count <> 1
    or one_hour_row.useful_vote_count <> 1
    or one_hour_row.distinct_voter_count <> 1 then
    raise exception 'Unexpected deduplicated 1h metrics: %', row_to_json(one_hour_row);
  end if;

  select trend.*
  into trend_row
  from public.opinion_topic_trends as trend
  where trend.topic_id = target_topic_id;

  if trend_row.lifecycle_status <> 'hot'
    or trend_row.dominant_window_minutes <> 60
    or trend_row.trend_score <= 0 then
    raise exception 'Topic did not become hot in the 1h window: %', row_to_json(trend_row);
  end if;

  perform public.refresh_opinion_trends(test_as_of + interval '2 hours');

  select trend.*
  into trend_row
  from public.opinion_topic_trends as trend
  where trend.topic_id = target_topic_id;

  if trend_row.lifecycle_status <> 'declining'
    or trend_row.dominant_window_minutes <> 360 then
    raise exception 'Topic did not enter the declining state: %', row_to_json(trend_row);
  end if;

  perform public.refresh_opinion_trends(test_as_of + interval '8 days');

  select trend.*
  into trend_row
  from public.opinion_topic_trends as trend
  where trend.topic_id = target_topic_id;

  if trend_row.lifecycle_status <> 'archived' then
    raise exception 'Topic was not archived after inactivity: %', row_to_json(trend_row);
  end if;

  raise notice
    'Trend smoke test passed; 1h deduplication, decline and archive verified';
end;
$$;

rollback;
