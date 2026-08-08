-- Transactional smoke test for DEV. Every inserted row and queue job is rolled back.
begin;

do $$
declare
  test_author text;
  target_topic_id uuid;
  target_cycle_id uuid;
  root_id uuid;
  comment_id uuid;
  nested_comment_id uuid;
  context_row record;
  affected_exposures integer;
  quality_row record;
begin
  select balance.bitcoin_address
  into test_author
  from public.user_balances as balance
  order by balance.bitcoin_address
  limit 1;

  if test_author is null then
    raise exception 'Smoke test requires at least one DEV user balance';
  end if;

  select topic.id, cycle.id
  into target_topic_id, target_cycle_id
  from public.opinion_topics as topic
  join public.opinion_topic_cycles as cycle on cycle.topic_id = topic.id
  where topic.slug = 'nuclear-power'
    and cycle.status = 'open';

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
    'Le maintien de reacteurs surs peut reduire les emissions du reseau electrique.',
    78,
    0,
    now(),
    'human'
  )
  returning id into root_id;

  insert into public.messages (
    bitcoin_address,
    content,
    char_count,
    cost_shells,
    created_at,
    content_origin,
    parent_id
  )
  values (
    test_author,
    'Cet argument depend aussi du cout complet et du calendrier.',
    58,
    0,
    now(),
    'human',
    root_id
  )
  returning id into comment_id;

  insert into public.messages (
    bitcoin_address,
    content,
    char_count,
    cost_shells,
    created_at,
    content_origin,
    parent_id
  )
  values (
    test_author,
    'Il faudrait donc comparer les hypotheses avec la meme methode.',
    61,
    0,
    now(),
    'human',
    comment_id
  )
  returning id into nested_comment_id;

  select *
  into context_row
  from public.get_opinion_message_embedding_input(nested_comment_id);

  if context_row.root_message_id is distinct from root_id
    or context_row.root_input_text is null
    or context_row.parent_input_text is null
    or context_row.target_input_text is null then
    raise exception 'Nested comment context was not assembled correctly';
  end if;

  insert into public.opinion_message_topic_scores (
    message_id,
    topic_id,
    relevance_score,
    accepted,
    is_primary,
    embedding_model
  )
  values
    (root_id, target_topic_id, 0.90, true, true, 'smoke-test'),
    (comment_id, target_topic_id, 0.90, true, true, 'smoke-test');

  affected_exposures := public.record_opinion_message_exposures(
    array[root_id, comment_id, root_id]
  );

  if affected_exposures <> 2 then
    raise exception
      'Expected 2 deduplicated cycle exposures, found %',
      affected_exposures;
  end if;

  update public.messages
  set useful_count = 1
  where id in (root_id, comment_id);

  perform public.refresh_opinion_cycle_quality(target_cycle_id);

  select quality.*
  into quality_row
  from public.opinion_cycle_message_quality as quality
  where quality.cycle_id = target_cycle_id
    and quality.message_id = root_id;

  if quality_row.message_exposure_count <> 1
    or quality_row.reply_exposure_count <> 1
    or quality_row.message_useful_count <> 1
    or quality_row.reply_useful_count <> 1
    or quality_row.distinct_reply_authors <> 1
    or quality_row.quality_score <= 0
    or quality_row.quality_score > 1 then
    raise exception 'Unexpected quality measurements: %', row_to_json(quality_row);
  end if;

  raise notice
    'Opinion smoke test passed; quality score=%',
    quality_row.quality_score;
end;
$$;

rollback;
