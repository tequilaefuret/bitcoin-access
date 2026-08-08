-- Transactional Stage 3B smoke test. Every message, vector and topic is rolled back.
begin;

create or replace function pg_temp.discovery_test_vector(
  p_first real,
  p_second real
)
returns extensions.vector(384)
language sql
immutable
set search_path = ''
as $$
  select (
    '[' || p_first::text || ',' || p_second::text || repeat(',0', 382) || ']'
  )::extensions.vector(384);
$$;

do $$
declare
  test_as_of timestamptz := now();
  test_author text;
  model_name text;
  first_root_id uuid;
  second_root_id uuid;
  third_root_id uuid;
  duplicate_root_id uuid;
  noise_root_id uuid;
  qualified_candidate_id uuid;
  noise_candidate_id uuid;
  expected_topic_id uuid;
  promoted_slug text := 'discovery-smoke-' || substr(md5(clock_timestamp()::text), 1, 12);
  discovery_result jsonb;
  qualified_row record;
begin
  select balance.bitcoin_address
  into test_author
  from public.user_balances as balance
  order by balance.bitcoin_address
  limit 1;

  if test_author is null then
    raise exception 'Discovery smoke test requires at least one DEV user balance';
  end if;

  select settings.embedding_model
  into model_name
  from public.opinion_classifier_settings as settings
  where settings.singleton = true;

  update public.opinion_topic_discovery_settings
  set
    min_content_chars = 20,
    attach_similarity = 0.98,
    representative_similarity = 0.98,
    qualify_min_roots = 3,
    qualify_min_authors = 2,
    qualify_min_average_similarity = 0.98,
    qualify_min_member_similarity = 0.98
  where singleton = true;

  -- Synthetic wallets are transaction-local and exist only to test author diversity.
  insert into public.user_balances (
    bitcoin_address,
    btc_balance,
    shells_balance
  )
  values
    (test_author || '-discovery-b', 0, 0),
    (test_author || '-discovery-c', 0, 0)
  on conflict (bitcoin_address) do nothing;

  insert into public.messages (
    bitcoin_address, content, char_count, cost_shells, created_at, content_origin
  ) values (
    test_author,
    'La ville teste un peage urbain progressif pour reduire les embouteillages.',
    75,
    0,
    test_as_of - interval '40 minutes',
    'human'
  ) returning id into first_root_id;

  insert into public.messages (
    bitcoin_address, content, char_count, cost_shells, created_at, content_origin
  ) values (
    test_author || '-discovery-b',
    'Le tarif de congestion pourrait financer des transports publics plus frequents.',
    79,
    0,
    test_as_of - interval '30 minutes',
    'human'
  ) returning id into second_root_id;

  insert into public.messages (
    bitcoin_address, content, char_count, cost_shells, created_at, content_origin
  ) values (
    test_author || '-discovery-c',
    'Un peage aux heures de pointe doit prevoir des exemptions sociales transparentes.',
    79,
    0,
    test_as_of - interval '20 minutes',
    'human'
  ) returning id into third_root_id;

  insert into public.messages (
    bitcoin_address, content, char_count, cost_shells, created_at, content_origin
  ) values (
    test_author,
    '  LA VILLE teste un peage urbain progressif pour reduire les embouteillages.  ',
    79,
    0,
    test_as_of - interval '10 minutes',
    'human'
  ) returning id into duplicate_root_id;

  insert into public.messages (
    bitcoin_address, content, char_count, cost_shells, created_at, content_origin
  ) values (
    test_author,
    'Cette recette de soupe demande de cuire les legumes avant de les mixer.',
    70,
    0,
    test_as_of - interval '5 minutes',
    'human'
  ) returning id into noise_root_id;

  update public.message_embeddings
  set
    embedding = case
      when message_id = noise_root_id then pg_temp.discovery_test_vector(0, 1)
      else pg_temp.discovery_test_vector(
        1,
        case
          when message_id = second_root_id then 0.05
          when message_id = third_root_id then -0.05
          else 0
        end
      )
    end,
    model = model_name,
    status = 'ready',
    last_error = null,
    updated_at = test_as_of
  where message_id in (
    first_root_id,
    second_root_id,
    third_root_id,
    duplicate_root_id,
    noise_root_id
  );

  discovery_result := public.refresh_opinion_topic_discovery(test_as_of);

  select candidate.*
  into qualified_row
  from public.opinion_topic_candidates as candidate
  where candidate.status = 'qualified'
    and candidate.representative_message_id in (
      first_root_id, second_root_id, third_root_id
    );

  if qualified_row.id is null
    or qualified_row.root_count <> 3
    or qualified_row.distinct_author_count <> 3
    or qualified_row.minimum_similarity < 0.98 then
    raise exception 'Expected one coherent qualified candidate: %', discovery_result;
  end if;
  qualified_candidate_id := qualified_row.id;

  if exists (
    select 1
    from public.opinion_topic_candidate_members as member
    where member.message_id = duplicate_root_id
  ) then
    raise exception 'Normalized duplicate was assigned to a candidate';
  end if;

  select candidate.id
  into noise_candidate_id
  from public.opinion_topic_candidates as candidate
  where candidate.representative_message_id = noise_root_id
    and candidate.status = 'collecting';

  if noise_candidate_id is null then
    raise exception 'Unrelated singleton should remain collecting';
  end if;

  expected_topic_id := public.promote_opinion_topic_candidate(
    qualified_candidate_id,
    promoted_slug,
    'Society',
    'Urban congestion pricing',
    'Should cities use variable road pricing to reduce congestion?',
    'Transactional discovery smoke test'
  );

  if not exists (
    select 1
    from public.opinion_topics as topic
    where topic.id = expected_topic_id
      and topic.slug = promoted_slug
      and topic.status = 'active'
  ) or not exists (
    select 1
    from public.opinion_topic_candidates as candidate
    where candidate.id = qualified_candidate_id
      and candidate.status = 'promoted'
      and candidate.promoted_topic_id = expected_topic_id
  ) then
    raise exception 'Qualified candidate promotion failed';
  end if;

  perform public.refresh_opinion_topic_discovery(test_as_of + interval '4 days');

  if not exists (
    select 1
    from public.opinion_topic_candidates as candidate
    where candidate.id = noise_candidate_id
      and candidate.status = 'expired'
  ) then
    raise exception 'Inactive singleton was not expired';
  end if;

  raise notice
    'Discovery smoke test passed; clustering, deduplication, promotion and expiry verified';
end;
$$;

rollback;
