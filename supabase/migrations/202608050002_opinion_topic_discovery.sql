-- Opinion Stage 3B: conservative discovery of new topics from unclassified roots.
-- Candidates remain private until an explicit service-side promotion.

create table if not exists public.opinion_topic_discovery_settings (
  singleton boolean primary key default true,
  lookback_interval interval not null default interval '48 hours',
  inactivity_ttl interval not null default interval '72 hours',
  min_content_chars integer not null default 60,
  max_roots_per_run integer not null default 2000,
  attach_similarity double precision not null default 0.90,
  representative_similarity double precision not null default 0.90,
  qualify_min_roots integer not null default 3,
  qualify_min_authors integer not null default 3,
  qualify_min_average_similarity double precision not null default 0.90,
  qualify_min_member_similarity double precision not null default 0.88,
  updated_at timestamptz not null default now(),
  constraint opinion_topic_discovery_settings_singleton_check check (singleton),
  constraint opinion_topic_discovery_settings_intervals_check check (
    lookback_interval > interval '0 seconds'
    and inactivity_ttl >= lookback_interval
  ),
  constraint opinion_topic_discovery_settings_limits_check check (
    min_content_chars >= 20
    and max_roots_per_run between 1 and 10000
    and qualify_min_roots >= 2
    and qualify_min_authors >= 2
  ),
  constraint opinion_topic_discovery_settings_similarity_check check (
    attach_similarity between -1 and 1
    and representative_similarity between -1 and 1
    and qualify_min_average_similarity between -1 and 1
    and qualify_min_member_similarity between -1 and 1
  )
);

insert into public.opinion_topic_discovery_settings (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.opinion_topic_candidates (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'collecting',
  embedding_model text not null,
  centroid extensions.vector(384) not null,
  representative_message_id uuid references public.messages(id) on delete set null,
  root_count integer not null default 0,
  distinct_author_count integer not null default 0,
  distinct_voter_count integer not null default 0,
  average_similarity double precision not null default 1,
  minimum_similarity double precision not null default 1,
  discovery_score double precision not null default 0,
  first_activity_at timestamptz not null,
  last_activity_at timestamptz not null,
  qualified_at timestamptz,
  reviewed_at timestamptz,
  review_note text,
  promoted_topic_id uuid references public.opinion_topics(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opinion_topic_candidates_status_check check (
    status in ('collecting', 'qualified', 'promoted', 'rejected', 'expired')
  ),
  constraint opinion_topic_candidates_counts_check check (
    root_count >= 0
    and distinct_author_count >= 0
    and distinct_voter_count >= 0
  ),
  constraint opinion_topic_candidates_similarity_check check (
    average_similarity between -1 and 1
    and minimum_similarity between -1 and 1
  ),
  constraint opinion_topic_candidates_score_check
    check (discovery_score between 0 and 100),
  constraint opinion_topic_candidates_dates_check
    check (last_activity_at >= first_activity_at),
  constraint opinion_topic_candidates_promotion_check check (
    (status = 'promoted' and promoted_topic_id is not null)
    or (status <> 'promoted' and promoted_topic_id is null)
  )
);

create table if not exists public.opinion_topic_candidate_members (
  candidate_id uuid not null references public.opinion_topic_candidates(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  content_fingerprint text not null,
  similarity_to_centroid double precision not null default 1,
  similarity_to_representative double precision not null default 1,
  assigned_at timestamptz not null default now(),
  primary key (candidate_id, message_id),
  constraint opinion_topic_candidate_members_message_unique unique (message_id),
  constraint opinion_topic_candidate_members_fingerprint_unique
    unique (content_fingerprint),
  constraint opinion_topic_candidate_members_similarity_check check (
    similarity_to_centroid between -1 and 1
    and similarity_to_representative between -1 and 1
  )
);

create table if not exists public.opinion_topic_discovery_runs (
  id bigint generated always as identity primary key,
  as_of timestamptz not null,
  eligible_root_count integer not null default 0,
  assigned_root_count integer not null default 0,
  created_candidate_count integer not null default 0,
  collecting_candidate_count integer not null default 0,
  qualified_candidate_count integer not null default 0,
  expired_candidate_count integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  constraint opinion_topic_discovery_runs_counts_check check (
    eligible_root_count >= 0
    and assigned_root_count >= 0
    and created_candidate_count >= 0
    and collecting_candidate_count >= 0
    and qualified_candidate_count >= 0
    and expired_candidate_count >= 0
  ),
  constraint opinion_topic_discovery_runs_dates_check
    check (completed_at >= started_at)
);

create index if not exists opinion_topic_candidates_review_idx
  on public.opinion_topic_candidates
  (status, discovery_score desc, last_activity_at desc);

create index if not exists opinion_topic_candidates_centroid_hnsw_idx
  on public.opinion_topic_candidates
  using hnsw (centroid extensions.vector_cosine_ops)
  where status in ('collecting', 'qualified');

create index if not exists opinion_topic_candidate_members_candidate_idx
  on public.opinion_topic_candidate_members
  (candidate_id, similarity_to_centroid desc);

create index if not exists opinion_topic_discovery_runs_as_of_idx
  on public.opinion_topic_discovery_runs (as_of desc);

alter table public.opinion_topic_discovery_settings enable row level security;
alter table public.opinion_topic_candidates enable row level security;
alter table public.opinion_topic_candidate_members enable row level security;
alter table public.opinion_topic_discovery_runs enable row level security;

revoke all on table public.opinion_topic_discovery_settings
  from public, anon, authenticated;
revoke all on table public.opinion_topic_candidates
  from public, anon, authenticated;
revoke all on table public.opinion_topic_candidate_members
  from public, anon, authenticated;
revoke all on table public.opinion_topic_discovery_runs
  from public, anon, authenticated;

create or replace function public.opinion_discovery_content_fingerprint(
  p_content text
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select md5(
    regexp_replace(
      lower(btrim(coalesce(p_content, ''))),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );
$$;

create or replace function public.refresh_opinion_topic_candidate_metrics(
  p_candidate_id uuid,
  p_as_of timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.opinion_topic_discovery_settings%rowtype;
  candidate_row public.opinion_topic_candidates%rowtype;
  next_centroid extensions.vector(384);
  next_representative_id uuid;
  next_representative_embedding extensions.vector(384);
  next_root_count integer;
  next_author_count integer;
  next_voter_count integer;
  next_first_activity timestamptz;
  next_last_activity timestamptz;
  next_average_similarity double precision;
  next_minimum_similarity double precision;
  next_discovery_score double precision;
  next_status text;
begin
  select * into settings
  from public.opinion_topic_discovery_settings
  where singleton = true;

  select * into candidate_row
  from public.opinion_topic_candidates
  where id = p_candidate_id
  for update;

  if not found or candidate_row.status not in ('collecting', 'qualified') then
    return coalesce(candidate_row.status, 'missing');
  end if;

  delete from public.opinion_topic_candidate_members as member
  where member.candidate_id = p_candidate_id
    and not exists (
      select 1
      from public.messages as message
      join public.message_embeddings as embedding
        on embedding.message_id = message.id
      where message.id = member.message_id
        and message.parent_id is null
        and message.repost_of is null
        and message.deleted_at is null
        and message.content_origin <> 'test'
        and embedding.status = 'ready'
        and embedding.embedding is not null
        and embedding.model = candidate_row.embedding_model
        and member.content_fingerprint
          = public.opinion_discovery_content_fingerprint(message.content)
        and not exists (
          select 1
          from public.opinion_message_topic_scores as score
          where score.message_id = message.id
            and score.accepted
        )
    );

  select
    extensions.avg(embedding.embedding),
    count(*)::integer,
    count(distinct message.bitcoin_address)::integer,
    min(message.created_at),
    max(message.created_at)
  into
    next_centroid,
    next_root_count,
    next_author_count,
    next_first_activity,
    next_last_activity
  from public.opinion_topic_candidate_members as member
  join public.messages as message on message.id = member.message_id
  join public.message_embeddings as embedding
    on embedding.message_id = member.message_id
  where member.candidate_id = p_candidate_id;

  if next_root_count = 0 then
    update public.opinion_topic_candidates
    set
      status = 'expired',
      root_count = 0,
      distinct_author_count = 0,
      distinct_voter_count = 0,
      discovery_score = 0,
      representative_message_id = null,
      updated_at = p_as_of
    where id = p_candidate_id;
    return 'expired';
  end if;

  select message.id, embedding.embedding
  into next_representative_id, next_representative_embedding
  from public.opinion_topic_candidate_members as member
  join public.messages as message on message.id = member.message_id
  join public.message_embeddings as embedding
    on embedding.message_id = member.message_id
  where member.candidate_id = p_candidate_id
  order by
    embedding.embedding operator(extensions.<=>) next_centroid,
    message.useful_count desc,
    message.created_at,
    message.id
  limit 1;

  update public.opinion_topic_candidate_members as member
  set
    similarity_to_centroid = 1 - (
      embedding.embedding operator(extensions.<=>) next_centroid
    ),
    similarity_to_representative = 1 - (
      embedding.embedding operator(extensions.<=>) next_representative_embedding
    )
  from public.message_embeddings as embedding
  where member.candidate_id = p_candidate_id
    and embedding.message_id = member.message_id;

  select
    avg(least(member.similarity_to_centroid, member.similarity_to_representative)),
    min(least(member.similarity_to_centroid, member.similarity_to_representative))
  into next_average_similarity, next_minimum_similarity
  from public.opinion_topic_candidate_members as member
  where member.candidate_id = p_candidate_id;

  select count(distinct vote.bitcoin_address)::integer
  into next_voter_count
  from public.opinion_topic_candidate_members as member
  join public.message_useful_votes as vote on vote.message_id = member.message_id
  where member.candidate_id = p_candidate_id;

  next_discovery_score := least(
    100::double precision,
    100 * (
      0.35 * least(1::double precision, next_root_count::double precision / settings.qualify_min_roots)
      + 0.35 * least(1::double precision, next_author_count::double precision / settings.qualify_min_authors)
      + 0.10 * least(1::double precision, next_voter_count::double precision / 3)
      + 0.20 * greatest(
        0::double precision,
        least(1::double precision, (next_average_similarity - 0.75) / 0.25)
      )
    )
  );

  next_status := case
    when next_root_count >= settings.qualify_min_roots
      and next_author_count >= settings.qualify_min_authors
      and next_average_similarity >= settings.qualify_min_average_similarity
      and next_minimum_similarity >= settings.qualify_min_member_similarity
      then 'qualified'
    else 'collecting'
  end;

  update public.opinion_topic_candidates
  set
    status = next_status,
    centroid = next_centroid,
    representative_message_id = next_representative_id,
    root_count = next_root_count,
    distinct_author_count = next_author_count,
    distinct_voter_count = coalesce(next_voter_count, 0),
    average_similarity = next_average_similarity,
    minimum_similarity = next_minimum_similarity,
    discovery_score = next_discovery_score,
    first_activity_at = next_first_activity,
    last_activity_at = next_last_activity,
    qualified_at = case
      when next_status = 'qualified' then coalesce(qualified_at, p_as_of)
      else null
    end,
    updated_at = p_as_of
  where id = p_candidate_id;

  return next_status;
end;
$$;

create or replace function public.refresh_opinion_topic_discovery(
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.opinion_topic_discovery_settings%rowtype;
  classifier_settings public.opinion_classifier_settings%rowtype;
  root_row record;
  candidate_row record;
  active_candidate record;
  run_started_at timestamptz := clock_timestamp();
  target_candidate_id uuid;
  target_centroid_similarity double precision;
  target_representative_similarity double precision;
  eligible_count integer := 0;
  assigned_count integer := 0;
  created_count integer := 0;
  collecting_count integer := 0;
  qualified_count integer := 0;
  expired_count integer := 0;
begin
  if p_as_of is null then
    raise exception 'Discovery calculation time cannot be null';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('opinion_topic_discovery', 0));

  select * into settings
  from public.opinion_topic_discovery_settings
  where singleton = true;

  select * into classifier_settings
  from public.opinion_classifier_settings
  where singleton = true;

  if settings.singleton is null or classifier_settings.singleton is null then
    raise exception 'Opinion discovery settings are missing';
  end if;

  update public.opinion_topic_candidates
  set status = 'expired', updated_at = p_as_of
  where status in ('collecting', 'qualified')
    and last_activity_at < p_as_of - settings.inactivity_ttl;

  for active_candidate in
    select candidate.id
    from public.opinion_topic_candidates as candidate
    where candidate.status in ('collecting', 'qualified')
    order by candidate.id
  loop
    perform public.refresh_opinion_topic_candidate_metrics(
      active_candidate.id,
      p_as_of
    );
  end loop;

  for root_row in
    with eligible as (
      select
        message.id,
        message.content,
        message.bitcoin_address,
        message.created_at,
        embedding.embedding,
        embedding.model,
        public.opinion_discovery_content_fingerprint(message.content)
          as content_fingerprint,
        row_number() over (
          partition by public.opinion_discovery_content_fingerprint(message.content)
          order by message.created_at, message.id
        ) as duplicate_rank
      from public.messages as message
      join public.message_embeddings as embedding
        on embedding.message_id = message.id
      where message.parent_id is null
        and message.repost_of is null
        and message.deleted_at is null
        and message.content_origin <> 'test'
        and message.created_at >= p_as_of - settings.lookback_interval
        and message.created_at < p_as_of
        and char_length(btrim(message.content)) >= settings.min_content_chars
        and embedding.status = 'ready'
        and embedding.embedding is not null
        and embedding.model = classifier_settings.embedding_model
        and not exists (
          select 1
          from public.opinion_message_topic_scores as score
          where score.message_id = message.id
            and score.accepted
        )
        and not exists (
          select 1
          from public.opinion_topic_candidate_members as member
          where member.message_id = message.id
        )
    )
    select eligible.*
    from eligible
    where eligible.duplicate_rank = 1
      and not exists (
        select 1
        from public.opinion_topic_candidate_members as member
        where member.content_fingerprint = eligible.content_fingerprint
      )
    order by eligible.created_at, eligible.id
    limit settings.max_roots_per_run
  loop
    eligible_count := eligible_count + 1;
    target_candidate_id := null;
    target_centroid_similarity := null;
    target_representative_similarity := null;

    select
      candidate.id,
      1 - (
        candidate.centroid operator(extensions.<=>) root_row.embedding
      ),
      1 - (
        representative_embedding.embedding
          operator(extensions.<=>) root_row.embedding
      )
    into
      target_candidate_id,
      target_centroid_similarity,
      target_representative_similarity
    from public.opinion_topic_candidates as candidate
    join public.message_embeddings as representative_embedding
      on representative_embedding.message_id = candidate.representative_message_id
    where candidate.status in ('collecting', 'qualified')
      and candidate.embedding_model = root_row.model
      and candidate.last_activity_at >= p_as_of - settings.inactivity_ttl
      and 1 - (
        candidate.centroid operator(extensions.<=>) root_row.embedding
      ) >= settings.attach_similarity
      and 1 - (
        representative_embedding.embedding
          operator(extensions.<=>) root_row.embedding
      ) >= settings.representative_similarity
    order by
      candidate.centroid operator(extensions.<=>) root_row.embedding,
      candidate.created_at,
      candidate.id
    limit 1;

    if target_candidate_id is null then
      insert into public.opinion_topic_candidates (
        embedding_model,
        centroid,
        representative_message_id,
        root_count,
        distinct_author_count,
        average_similarity,
        minimum_similarity,
        first_activity_at,
        last_activity_at
      )
      values (
        root_row.model,
        root_row.embedding,
        root_row.id,
        1,
        1,
        1,
        1,
        root_row.created_at,
        root_row.created_at
      )
      returning id into target_candidate_id;

      target_centroid_similarity := 1;
      target_representative_similarity := 1;
      created_count := created_count + 1;
    end if;

    insert into public.opinion_topic_candidate_members (
      candidate_id,
      message_id,
      content_fingerprint,
      similarity_to_centroid,
      similarity_to_representative,
      assigned_at
    )
    values (
      target_candidate_id,
      root_row.id,
      root_row.content_fingerprint,
      target_centroid_similarity,
      target_representative_similarity,
      p_as_of
    )
    on conflict do nothing;

    if found then
      assigned_count := assigned_count + 1;
      perform public.refresh_opinion_topic_candidate_metrics(
        target_candidate_id,
        p_as_of
      );
    end if;
  end loop;

  for candidate_row in
    select candidate.id
    from public.opinion_topic_candidates as candidate
    where candidate.status in ('collecting', 'qualified')
    order by candidate.id
  loop
    perform public.refresh_opinion_topic_candidate_metrics(
      candidate_row.id,
      p_as_of
    );
  end loop;

  select
    count(*) filter (where status = 'collecting')::integer,
    count(*) filter (where status = 'qualified')::integer,
    count(*) filter (where status = 'expired')::integer
  into collecting_count, qualified_count, expired_count
  from public.opinion_topic_candidates;

  insert into public.opinion_topic_discovery_runs (
    as_of,
    eligible_root_count,
    assigned_root_count,
    created_candidate_count,
    collecting_candidate_count,
    qualified_candidate_count,
    expired_candidate_count,
    started_at,
    completed_at
  )
  values (
    p_as_of,
    eligible_count,
    assigned_count,
    created_count,
    collecting_count,
    qualified_count,
    expired_count,
    run_started_at,
    clock_timestamp()
  );

  return jsonb_build_object(
    'as_of', p_as_of,
    'eligible_roots', eligible_count,
    'assigned_roots', assigned_count,
    'created_candidates', created_count,
    'states', jsonb_build_object(
      'collecting', collecting_count,
      'qualified', qualified_count,
      'expired', expired_count
    )
  );
end;
$$;

create or replace function public.promote_opinion_topic_candidate(
  p_candidate_id uuid,
  p_slug text,
  p_category text,
  p_title text,
  p_question text,
  p_review_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_row public.opinion_topic_candidates%rowtype;
  next_topic_id uuid;
  next_sort_rank integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_candidate_id::text, 0));

  select * into candidate_row
  from public.opinion_topic_candidates
  where id = p_candidate_id
  for update;

  if not found or candidate_row.status <> 'qualified' then
    raise exception 'Only a qualified Opinion candidate can be promoted';
  end if;

  if p_slug is null or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or nullif(btrim(p_category), '') is null
    or nullif(btrim(p_title), '') is null
    or nullif(btrim(p_question), '') is null then
    raise exception 'A valid slug, category, title and question are required';
  end if;

  select coalesce(max(topic.sort_rank), 0) + 10
  into next_sort_rank
  from public.opinion_topics as topic;

  insert into public.opinion_topics (
    slug,
    category,
    title,
    question,
    status,
    sort_rank
  )
  values (
    p_slug,
    btrim(p_category),
    btrim(p_title),
    btrim(p_question),
    'active',
    next_sort_rank
  )
  returning id into next_topic_id;

  update public.opinion_topic_candidates
  set
    status = 'promoted',
    promoted_topic_id = next_topic_id,
    reviewed_at = now(),
    review_note = nullif(btrim(p_review_note), ''),
    updated_at = now()
  where id = p_candidate_id;

  return next_topic_id;
end;
$$;

create or replace function public.reject_opinion_topic_candidate(
  p_candidate_id uuid,
  p_review_note text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.opinion_topic_candidates
  set
    status = 'rejected',
    reviewed_at = now(),
    review_note = nullif(btrim(p_review_note), ''),
    updated_at = now()
  where id = p_candidate_id
    and status in ('collecting', 'qualified');

  return found;
end;
$$;

revoke all on function public.opinion_discovery_content_fingerprint(text)
  from public, anon, authenticated;
revoke all on function public.refresh_opinion_topic_candidate_metrics(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.refresh_opinion_topic_discovery(timestamptz)
  from public, anon, authenticated;
revoke all on function public.promote_opinion_topic_candidate(
  uuid, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.reject_opinion_topic_candidate(uuid, text)
  from public, anon, authenticated;

grant execute on function public.refresh_opinion_topic_discovery(timestamptz)
  to service_role, danaus_opinion_worker;
grant execute on function public.promote_opinion_topic_candidate(
  uuid, text, text, text, text, text
) to service_role;
grant execute on function public.reject_opinion_topic_candidate(uuid, text)
  to service_role;

select public.refresh_opinion_topic_discovery(now());
