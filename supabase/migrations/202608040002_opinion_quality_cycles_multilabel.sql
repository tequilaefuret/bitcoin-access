-- Opinion ranking foundation: contextual embeddings, multi-topic scores,
-- hermetic topic cycles, load exposures and an explicit quality score.

alter table public.messages
  add column if not exists content_origin text not null default 'human';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'messages_content_origin_check'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_content_origin_check
      check (content_origin in ('human', 'agent', 'test', 'imported'));
  end if;
end;
$$;

create index if not exists messages_content_origin_created_at_idx
  on public.messages (content_origin, created_at desc)
  where deleted_at is null;

create table if not exists public.opinion_topic_classifier_settings (
  topic_id uuid primary key references public.opinion_topics(id) on delete cascade,
  min_similarity double precision not null default 0.85,
  updated_at timestamptz not null default now(),
  constraint opinion_topic_classifier_settings_similarity_check
    check (min_similarity >= -1 and min_similarity <= 1)
);

-- The former 0.72 threshold was calibrated on test babble. A versioned
-- 800-case validation set shows that multilingual E5 needs thresholds around
-- 0.85 for a conservative candidate pool.
update public.opinion_classifier_settings
set min_similarity = 0.85,
    updated_at = now()
where singleton = true
  and min_similarity = 0.72;

insert into public.opinion_topic_classifier_settings (topic_id, min_similarity)
select topic.id, settings.min_similarity
from public.opinion_topics as topic
cross join public.opinion_classifier_settings as settings
where topic.status = 'active'
  and settings.singleton = true
on conflict (topic_id) do nothing;

-- Initial per-topic thresholds maximize recall while retaining at least 90%
-- measured precision on validation set v1. They are internal model settings.
update public.opinion_topic_classifier_settings as settings
set
  min_similarity = calibrated.min_similarity,
  updated_at = now()
from (
  values
    ('inflation-and-savings', 0.854::double precision),
    ('remote-work-and-productivity', 0.844::double precision),
    ('nuclear-power', 0.852::double precision),
    ('ai-regulation', 0.847::double precision)
) as calibrated(slug, min_similarity)
join public.opinion_topics as topic on topic.slug = calibrated.slug
where settings.topic_id = topic.id;

create table if not exists public.opinion_message_topic_scores (
  message_id uuid not null references public.messages(id) on delete cascade,
  topic_id uuid not null references public.opinion_topics(id) on delete cascade,
  relevance_score double precision not null,
  accepted boolean not null,
  is_primary boolean not null default false,
  embedding_model text not null,
  classified_at timestamptz not null default now(),
  primary key (message_id, topic_id),
  constraint opinion_message_topic_scores_relevance_check
    check (relevance_score >= -1 and relevance_score <= 1),
  constraint opinion_message_topic_scores_primary_check
    check (not is_primary or accepted)
);

create index if not exists opinion_message_topic_scores_feed_idx
  on public.opinion_message_topic_scores
  (topic_id, relevance_score desc, classified_at desc)
  where accepted;

create index if not exists opinion_message_topic_scores_message_idx
  on public.opinion_message_topic_scores (message_id, accepted, relevance_score desc);

create table if not exists public.opinion_topic_cycles (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.opinion_topics(id) on delete cascade,
  sequence_number integer not null,
  status text not null default 'open',
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  constraint opinion_topic_cycles_topic_sequence_unique
    unique (topic_id, sequence_number),
  constraint opinion_topic_cycles_status_check
    check (status in ('open', 'closed', 'archived')),
  constraint opinion_topic_cycles_dates_check
    check (ends_at is null or ends_at > starts_at),
  constraint opinion_topic_cycles_open_end_check
    check (status <> 'open' or ends_at is null)
);

create unique index if not exists opinion_topic_cycles_one_open_idx
  on public.opinion_topic_cycles (topic_id)
  where status = 'open';

create index if not exists opinion_topic_cycles_feed_idx
  on public.opinion_topic_cycles (status, starts_at desc, topic_id);

create table if not exists public.opinion_cycle_message_exposures (
  cycle_id uuid not null references public.opinion_topic_cycles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  exposure_count bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (cycle_id, message_id),
  constraint opinion_cycle_message_exposures_count_check
    check (exposure_count >= 0)
);

create table if not exists public.opinion_cycle_message_quality (
  cycle_id uuid not null references public.opinion_topic_cycles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  root_message_id uuid not null references public.messages(id) on delete cascade,
  message_exposure_count bigint not null default 0,
  message_useful_count bigint not null default 0,
  reply_exposure_count bigint not null default 0,
  reply_useful_count bigint not null default 0,
  distinct_reply_authors integer not null default 0,
  useful_component double precision not null default 0,
  reply_component double precision not null default 0,
  breadth_component double precision not null default 0,
  quality_score double precision not null default 0,
  calculated_at timestamptz not null default now(),
  primary key (cycle_id, message_id),
  constraint opinion_cycle_message_quality_nonnegative_check check (
    message_exposure_count >= 0
    and message_useful_count >= 0
    and reply_exposure_count >= 0
    and reply_useful_count >= 0
    and distinct_reply_authors >= 0
  ),
  constraint opinion_cycle_message_quality_components_check check (
    useful_component between 0 and 1
    and reply_component between 0 and 1
    and breadth_component between 0 and 1
    and quality_score between 0 and 1
  )
);

create index if not exists opinion_cycle_message_quality_feed_idx
  on public.opinion_cycle_message_quality
  (cycle_id, quality_score desc, calculated_at desc);

alter table public.opinion_topic_classifier_settings enable row level security;
alter table public.opinion_message_topic_scores enable row level security;
alter table public.opinion_topic_cycles enable row level security;
alter table public.opinion_cycle_message_exposures enable row level security;
alter table public.opinion_cycle_message_quality enable row level security;

revoke all on table public.opinion_topic_classifier_settings
  from public, anon, authenticated;
revoke all on table public.opinion_message_topic_scores
  from public, anon, authenticated;
revoke all on table public.opinion_topic_cycles
  from public, anon, authenticated;
revoke all on table public.opinion_cycle_message_exposures
  from public, anon, authenticated;
revoke all on table public.opinion_cycle_message_quality
  from public, anon, authenticated;

-- A comment is embedded with its root publication and immediate parent. If the
-- ancestry is broken, deleted or marked as test data, no input is returned.
create or replace function public.get_opinion_message_embedding_input(
  p_message_id uuid
)
returns table (
  input_text text,
  content_hash text,
  root_message_id uuid,
  root_input_text text,
  parent_input_text text,
  target_input_text text
)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive lineage as (
    select
      message.id,
      message.parent_id,
      message.content,
      0 as depth,
      array[message.id]::uuid[] as path
    from public.messages as message
    where message.id = p_message_id
      and message.deleted_at is null
      and message.content_origin <> 'test'

    union all

    select
      parent.id,
      parent.parent_id,
      parent.content,
      child.depth + 1,
      child.path || parent.id
    from lineage as child
    join public.messages as parent on parent.id = child.parent_id
    where child.depth < 31
      and parent.deleted_at is null
      and parent.content_origin <> 'test'
      and not parent.id = any(child.path)
  ),
  message_parts as (
    select
      target.id as target_id,
      target.content as target_content,
      parent.id as parent_id,
      parent.content as parent_content,
      root.id as root_id,
      root.parent_id as root_parent_id,
      root.content as root_content
    from lineage as target
    cross join lateral (
      select candidate.id, candidate.parent_id, candidate.content
      from lineage as candidate
      order by candidate.depth desc
      limit 1
    ) as root
    left join lineage as parent on parent.depth = 1
    where target.depth = 0
  ),
  composed as (
    select
      case
        when parts.target_id = parts.root_id then
          concat('passage: Publication:', E'\n', parts.target_content)
        else
          concat(
            'passage: Publication principale:', E'\n', parts.root_content,
            case
              when parts.parent_id is not null and parts.parent_id <> parts.root_id then
                concat(E'\n\n', 'Contexte parent:', E'\n', parts.parent_content)
              else ''
            end,
            E'\n\n', 'Intervention a classifier:', E'\n', parts.target_content
          )
      end as input_text,
      parts.root_id as root_message_id,
      case
        when parts.target_id = parts.root_id then null
        else concat('passage: Publication principale:', E'\n', parts.root_content)
      end as root_input_text,
      case
        when parts.parent_id is not null and parts.parent_id <> parts.root_id then
          concat('passage: Contexte parent:', E'\n', parts.parent_content)
        else null
      end as parent_input_text,
      case
        when parts.target_id = parts.root_id then
          concat('passage: Publication:', E'\n', parts.target_content)
        else
          concat('passage: Intervention a classifier:', E'\n', parts.target_content)
      end as target_input_text
    from message_parts as parts
    where parts.root_parent_id is null
  )
  select
    composed.input_text,
    md5(composed.input_text) as content_hash,
    composed.root_message_id,
    composed.root_input_text,
    composed.parent_input_text,
    composed.target_input_text
  from composed;
$$;

create or replace function public.classify_opinion_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  classifier_settings public.opinion_classifier_settings%rowtype;
  message_model text;
  best_topic_id uuid;
  best_accepted_topic_id uuid;
  second_topic_id uuid;
  best_similarity double precision;
  second_similarity double precision;
  score_margin double precision;
  accepted_count integer := 0;
  accepted_matches jsonb := '[]'::jsonb;
  uncertainty text;
begin
  perform 1
  from public.get_opinion_message_embedding_input(p_message_id);

  if not found then
    delete from public.opinion_message_topic_scores where message_id = p_message_id;
    delete from public.opinion_message_topic_matches where message_id = p_message_id;
    return jsonb_build_object('status', 'excluded', 'message_id', p_message_id);
  end if;

  select *
  into classifier_settings
  from public.opinion_classifier_settings
  where singleton = true;

  select embedding.model
  into message_model
  from public.message_embeddings as embedding
  where embedding.message_id = p_message_id
    and embedding.status = 'ready'
    and embedding.embedding is not null;

  if not found then
    delete from public.opinion_message_topic_scores where message_id = p_message_id;
    delete from public.opinion_message_topic_matches where message_id = p_message_id;
    return jsonb_build_object('status', 'not_ready', 'message_id', p_message_id);
  end if;

  delete from public.opinion_message_topic_scores where message_id = p_message_id;

  with scored as (
    select
      topic_embedding.topic_id,
      1 - (
        topic_embedding.embedding
        operator(extensions.<=>)
        message_embedding.embedding
      ) as relevance_score,
      coalesce(
        topic_settings.min_similarity,
        classifier_settings.min_similarity
      ) as min_similarity
    from public.opinion_topic_embeddings as topic_embedding
    join public.opinion_topics as topic on topic.id = topic_embedding.topic_id
    join public.message_embeddings as message_embedding
      on message_embedding.message_id = p_message_id
    left join public.opinion_topic_classifier_settings as topic_settings
      on topic_settings.topic_id = topic_embedding.topic_id
    where topic.status = 'active'
      and topic_embedding.status = 'ready'
      and topic_embedding.embedding is not null
      and topic_embedding.model = message_embedding.model
  ),
  thresholded as (
    select
      scored.*,
      scored.relevance_score >= scored.min_similarity as accepted
    from scored
  ),
  ranked as (
    select
      thresholded.*,
      row_number() over (
        partition by thresholded.accepted
        order by thresholded.relevance_score desc, thresholded.topic_id
      ) as acceptance_rank
    from thresholded
  )
  insert into public.opinion_message_topic_scores (
    message_id,
    topic_id,
    relevance_score,
    accepted,
    is_primary,
    embedding_model,
    classified_at
  )
  select
    p_message_id,
    ranked.topic_id,
    ranked.relevance_score,
    ranked.accepted,
    ranked.accepted and ranked.acceptance_rank = 1,
    message_model,
    now()
  from ranked;

  select score.topic_id, score.relevance_score
  into best_topic_id, best_similarity
  from public.opinion_message_topic_scores as score
  where score.message_id = p_message_id
  order by score.relevance_score desc, score.topic_id
  limit 1;

  select score.topic_id, score.relevance_score
  into second_topic_id, second_similarity
  from public.opinion_message_topic_scores as score
  where score.message_id = p_message_id
  order by score.relevance_score desc, score.topic_id
  offset 1
  limit 1;

  select score.topic_id
  into best_accepted_topic_id
  from public.opinion_message_topic_scores as score
  where score.message_id = p_message_id
    and score.is_primary
  limit 1;

  select
    count(*)::integer,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'topic_id', score.topic_id,
          'similarity', score.relevance_score,
          'primary', score.is_primary
        )
        order by score.relevance_score desc
      ),
      '[]'::jsonb
    )
  into accepted_count, accepted_matches
  from public.opinion_message_topic_scores as score
  where score.message_id = p_message_id
    and score.accepted;

  score_margin := case
    when best_topic_id is null then null
    when second_topic_id is null then 2
    else best_similarity - second_similarity
  end;

  uncertainty := case
    when best_topic_id is null then 'no_active_topic_embeddings'
    when accepted_count = 0 then 'below_similarity_threshold'
    else null
  end;

  insert into public.opinion_message_topic_matches (
    message_id,
    topic_id,
    candidate_topic_id,
    status,
    similarity_score,
    second_best_score,
    confidence_margin,
    uncertainty_reason,
    embedding_model,
    classified_at
  )
  values (
    p_message_id,
    best_accepted_topic_id,
    best_topic_id,
    case when accepted_count > 0 then 'matched' else 'uncertain' end,
    best_similarity,
    second_similarity,
    score_margin,
    uncertainty,
    message_model,
    now()
  )
  on conflict (message_id) do update set
    topic_id = excluded.topic_id,
    candidate_topic_id = excluded.candidate_topic_id,
    status = excluded.status,
    similarity_score = excluded.similarity_score,
    second_best_score = excluded.second_best_score,
    confidence_margin = excluded.confidence_margin,
    uncertainty_reason = excluded.uncertainty_reason,
    embedding_model = excluded.embedding_model,
    classified_at = excluded.classified_at;

  return jsonb_build_object(
    'status', case when accepted_count > 0 then 'matched' else 'uncertain' end,
    'message_id', p_message_id,
    'matches', accepted_matches,
    'candidate_topic_id', best_topic_id,
    'best_similarity', best_similarity,
    'second_best_similarity', second_similarity,
    'margin', score_margin,
    'reason', uncertainty
  );
end;
$$;

-- Editing a root publication invalidates every descendant because their model
-- input contains that root. Test data is deliberately excluded from the queue.
create or replace function public.enqueue_opinion_message_embedding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_row record;
  target_hash text;
begin
  if TG_OP = 'UPDATE'
    and NEW.content is not distinct from OLD.content
    and NEW.deleted_at is not distinct from OLD.deleted_at
    and NEW.content_origin is not distinct from OLD.content_origin then
    return NEW;
  end if;

  for target_row in
    with recursive descendants as (
      select message.id
      from public.messages as message
      where message.id = NEW.id

      union

      select child.id
      from public.messages as child
      join descendants as parent on child.parent_id = parent.id
    )
    select descendants.id
    from descendants
  loop
    select embedding_input.content_hash
    into target_hash
    from public.get_opinion_message_embedding_input(target_row.id) as embedding_input;

    if not found then
      delete from public.opinion_message_topic_scores
      where message_id = target_row.id;
      delete from public.opinion_message_topic_matches
      where message_id = target_row.id;
      delete from public.message_embeddings
      where message_id = target_row.id;
      continue;
    end if;

    insert into public.message_embeddings (
      message_id,
      content_hash,
      status,
      attempt_count,
      last_error,
      updated_at
    )
    values (target_row.id, target_hash, 'pending', 0, null, now())
    on conflict (message_id) do update set
      content_hash = excluded.content_hash,
      embedding = null,
      model = null,
      status = 'pending',
      attempt_count = 0,
      last_error = null,
      updated_at = now();

    delete from public.opinion_message_topic_scores
    where message_id = target_row.id;
    delete from public.opinion_message_topic_matches
    where message_id = target_row.id;

    begin
      perform pgmq.send(
        queue_name => 'opinion_embeddings',
        msg => jsonb_build_object(
          'action', 'embed',
          'entity_type', 'message',
          'entity_id', target_row.id,
          'content_hash', target_hash
        )
      );
    exception when others then
      update public.message_embeddings
      set status = 'error', last_error = SQLERRM, updated_at = now()
      where message_id = target_row.id;
    end;
  end loop;

  return NEW;
end;
$$;

create or replace function public.requeue_opinion_embedding_jobs(
  p_include_ready boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  classifier_settings public.opinion_classifier_settings%rowtype;
  topic_row record;
  message_row record;
  queued_count integer := 0;
begin
  select *
  into classifier_settings
  from public.opinion_classifier_settings
  where singleton = true;

  for topic_row in
    select
      topic.id,
      md5(concat_ws(E'\n', topic.category, topic.title, topic.question)) as content_hash
    from public.opinion_topics as topic
    left join public.opinion_topic_embeddings as embedding
      on embedding.topic_id = topic.id
    where topic.status = 'active'
      and (
        p_include_ready
        or embedding.topic_id is null
        or embedding.status <> 'ready'
        or embedding.model is distinct from classifier_settings.embedding_model
        or embedding.content_hash is distinct from
          md5(concat_ws(E'\n', topic.category, topic.title, topic.question))
      )
  loop
    insert into public.opinion_topic_embeddings (topic_id, content_hash, status)
    values (topic_row.id, topic_row.content_hash, 'pending')
    on conflict (topic_id) do update set
      content_hash = excluded.content_hash,
      embedding = null,
      model = null,
      status = 'pending',
      attempt_count = 0,
      last_error = null,
      updated_at = now();

    perform pgmq.send(
      queue_name => 'opinion_embeddings',
      msg => jsonb_build_object(
        'action', 'embed',
        'entity_type', 'topic',
        'entity_id', topic_row.id,
        'content_hash', topic_row.content_hash
      )
    );
    queued_count := queued_count + 1;
  end loop;

  delete from public.opinion_message_topic_scores as score
  where not exists (
    select 1
    from public.get_opinion_message_embedding_input(score.message_id)
  );

  delete from public.opinion_message_topic_matches as match
  where not exists (
    select 1
    from public.get_opinion_message_embedding_input(match.message_id)
  );

  delete from public.message_embeddings as embedding
  where not exists (
    select 1
    from public.get_opinion_message_embedding_input(embedding.message_id)
  );

  for message_row in
    select
      message.id,
      embedding_input.content_hash
    from public.messages as message
    cross join lateral public.get_opinion_message_embedding_input(message.id)
      as embedding_input
    left join public.message_embeddings as embedding
      on embedding.message_id = message.id
    where p_include_ready
      or embedding.message_id is null
      or embedding.status <> 'ready'
      or embedding.model is distinct from classifier_settings.embedding_model
      or embedding.content_hash is distinct from embedding_input.content_hash
  loop
    insert into public.message_embeddings (message_id, content_hash, status)
    values (message_row.id, message_row.content_hash, 'pending')
    on conflict (message_id) do update set
      content_hash = excluded.content_hash,
      embedding = null,
      model = null,
      status = 'pending',
      attempt_count = 0,
      last_error = null,
      updated_at = now();

    delete from public.opinion_message_topic_scores
    where message_id = message_row.id;
    delete from public.opinion_message_topic_matches
    where message_id = message_row.id;

    perform pgmq.send(
      queue_name => 'opinion_embeddings',
      msg => jsonb_build_object(
        'action', 'embed',
        'entity_type', 'message',
        'entity_id', message_row.id,
        'content_hash', message_row.content_hash
      )
    );
    queued_count := queued_count + 1;
  end loop;

  return queued_count;
end;
$$;

drop trigger if exists messages_enqueue_opinion_embedding on public.messages;
create trigger messages_enqueue_opinion_embedding
after insert or update of content, deleted_at, content_origin on public.messages
for each row execute function public.enqueue_opinion_message_embedding();

create or replace function public.open_opinion_topic_cycle(
  p_topic_id uuid,
  p_starts_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_cycle public.opinion_topic_cycles%rowtype;
  next_sequence integer;
  new_cycle_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_topic_id::text, 0));

  perform 1
  from public.opinion_topics as topic
  where topic.id = p_topic_id
    and topic.status = 'active'
  for update;

  if not found then
    raise exception 'Active opinion topic not found';
  end if;

  select cycle.*
  into current_cycle
  from public.opinion_topic_cycles as cycle
  where cycle.topic_id = p_topic_id
    and cycle.status = 'open'
  for update;

  if found and p_starts_at <= current_cycle.starts_at then
    raise exception 'A new cycle must start after the current cycle';
  end if;

  if current_cycle.id is not null then
    update public.opinion_topic_cycles
    set status = 'closed', ends_at = p_starts_at
    where id = current_cycle.id;
  end if;

  select coalesce(max(cycle.sequence_number), 0) + 1
  into next_sequence
  from public.opinion_topic_cycles as cycle
  where cycle.topic_id = p_topic_id;

  insert into public.opinion_topic_cycles (
    topic_id,
    sequence_number,
    status,
    starts_at
  )
  values (p_topic_id, next_sequence, 'open', p_starts_at)
  returning id into new_cycle_id;

  return new_cycle_id;
end;
$$;

create or replace function public.sync_opinion_topic_cycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_topic_id uuid;
  default_similarity double precision;
begin
  target_topic_id := case when TG_OP = 'DELETE' then OLD.id else NEW.id end;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;

  if TG_OP = 'UPDATE' and (
    NEW.category is distinct from OLD.category
    or NEW.title is distinct from OLD.title
    or NEW.question is distinct from OLD.question
    or NEW.status is distinct from OLD.status
  ) then
    delete from public.opinion_message_topic_scores
    where topic_id = target_topic_id;
  end if;

  if NEW.status = 'active' then
    select settings.min_similarity
    into default_similarity
    from public.opinion_classifier_settings as settings
    where settings.singleton = true;

    insert into public.opinion_topic_classifier_settings (topic_id, min_similarity)
    values (NEW.id, coalesce(default_similarity, 0.85))
    on conflict (topic_id) do nothing;

    if not exists (
      select 1
      from public.opinion_topic_cycles as cycle
      where cycle.topic_id = NEW.id
        and cycle.status = 'open'
    ) then
      perform public.open_opinion_topic_cycle(NEW.id, now());
    end if;
  else
    update public.opinion_topic_cycles
    set status = 'closed', ends_at = greatest(now(), starts_at + interval '1 microsecond')
    where topic_id = NEW.id
      and status = 'open';
  end if;

  return NEW;
end;
$$;

drop trigger if exists opinion_topics_sync_cycles on public.opinion_topics;
create trigger opinion_topics_sync_cycles
after insert or update of category, title, question, status on public.opinion_topics
for each row execute function public.sync_opinion_topic_cycle();

insert into public.opinion_topic_cycles (
  topic_id,
  sequence_number,
  status,
  starts_at
)
select topic.id, 1, 'open', now()
from public.opinion_topics as topic
where topic.status = 'active'
  and not exists (
    select 1
    from public.opinion_topic_cycles as cycle
    where cycle.topic_id = topic.id
  );

-- One-sided 80% Wilson lower bound (z = 1.281551565545). It prevents a post
-- with one exposure and one Useful signal from immediately dominating a feed.
create or replace function public.opinion_wilson_lower_bound(
  p_successes bigint,
  p_trials bigint,
  p_z double precision default 1.281551565545
)
returns double precision
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when greatest(coalesce(p_trials, 0), 0) = 0 then 0::double precision
    else greatest(
      0::double precision,
      least(
        1::double precision,
        (
          bounded.proportion
          + power(p_z, 2) / (2 * bounded.trials)
          - p_z * sqrt(
            (
              bounded.proportion * (1 - bounded.proportion)
              + power(p_z, 2) / (4 * bounded.trials)
            ) / bounded.trials
          )
        ) / (1 + power(p_z, 2) / bounded.trials)
      )
    )
  end
  from (
    select
      greatest(coalesce(p_trials, 0), 0)::double precision as trials,
      least(
        greatest(coalesce(p_successes, 0), 0),
        greatest(coalesce(p_trials, 0), 0)
      )::double precision
      / nullif(greatest(coalesce(p_trials, 0), 0), 0) as proportion
  ) as bounded;
$$;

create or replace function public.record_opinion_message_exposures(
  p_message_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_count integer := 0;
begin
  with requested as (
    select distinct requested_id as message_id
    from unnest(coalesce(p_message_ids, '{}'::uuid[])) as requested_id
  ),
  eligible as (
    select cycle.id as cycle_id, message.id as message_id
    from requested
    join public.messages as message on message.id = requested.message_id
    cross join lateral public.get_opinion_message_embedding_input(message.id)
      as embedding_input
    join public.messages as root_message
      on root_message.id = embedding_input.root_message_id
    join public.opinion_message_topic_scores as score
      on score.message_id = message.id
      and score.accepted
    join public.opinion_topic_cycles as cycle
      on cycle.topic_id = score.topic_id
      and cycle.status = 'open'
    where message.deleted_at is null
      and message.content_origin <> 'test'
      and message.repost_of is null
      and message.created_at >= cycle.starts_at
      and message.created_at < coalesce(cycle.ends_at, 'infinity'::timestamptz)
      and root_message.created_at >= cycle.starts_at
      and root_message.created_at < coalesce(cycle.ends_at, 'infinity'::timestamptz)
  )
  insert into public.opinion_cycle_message_exposures (
    cycle_id,
    message_id,
    exposure_count,
    updated_at
  )
  select eligible.cycle_id, eligible.message_id, 1, now()
  from eligible
  on conflict (cycle_id, message_id) do update set
    exposure_count = public.opinion_cycle_message_exposures.exposure_count + 1,
    updated_at = now();

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

create or replace function public.refresh_opinion_cycle_quality(p_cycle_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  refreshed_count integer := 0;
begin
  delete from public.opinion_cycle_message_quality
  where cycle_id = p_cycle_id;

  with candidates as (
    select
      cycle.id as cycle_id,
      cycle.topic_id,
      cycle.starts_at,
      cycle.ends_at,
      message.id as message_id,
      message.useful_count::bigint as message_useful_count,
      embedding_input.root_message_id,
      coalesce(exposure.exposure_count, 0)::bigint as message_exposure_count
    from public.opinion_topic_cycles as cycle
    join public.opinion_message_topic_scores as score
      on score.topic_id = cycle.topic_id
      and score.accepted
    join public.messages as message on message.id = score.message_id
    cross join lateral public.get_opinion_message_embedding_input(message.id)
      as embedding_input
    join public.messages as root_message
      on root_message.id = embedding_input.root_message_id
    left join public.opinion_cycle_message_exposures as exposure
      on exposure.cycle_id = cycle.id
      and exposure.message_id = message.id
    where cycle.id = p_cycle_id
      and message.deleted_at is null
      and message.content_origin <> 'test'
      and message.repost_of is null
      and message.created_at >= cycle.starts_at
      and message.created_at < coalesce(cycle.ends_at, 'infinity'::timestamptz)
      and root_message.created_at >= cycle.starts_at
      and root_message.created_at < coalesce(cycle.ends_at, 'infinity'::timestamptz)
  ),
  measurements as (
    select
      candidate.*,
      coalesce(reply_stats.reply_exposure_count, 0)::bigint as reply_exposure_count,
      coalesce(reply_stats.reply_useful_count, 0)::bigint as reply_useful_count,
      coalesce(reply_stats.distinct_reply_authors, 0)::integer as distinct_reply_authors
    from candidates as candidate
    left join lateral (
      select
        coalesce(sum(reply_exposure.exposure_count), 0)::bigint
          as reply_exposure_count,
        coalesce(sum(reply.useful_count), 0)::bigint as reply_useful_count,
        count(distinct reply.bitcoin_address)::integer as distinct_reply_authors
      from public.messages as reply
      join public.opinion_message_topic_scores as reply_score
        on reply_score.message_id = reply.id
        and reply_score.topic_id = candidate.topic_id
        and reply_score.accepted
      left join public.opinion_cycle_message_exposures as reply_exposure
        on reply_exposure.cycle_id = candidate.cycle_id
        and reply_exposure.message_id = reply.id
      where reply.parent_id = candidate.message_id
        and reply.deleted_at is null
        and reply.content_origin <> 'test'
        and reply.repost_of is null
        and reply.created_at >= candidate.starts_at
        and reply.created_at < coalesce(candidate.ends_at, 'infinity'::timestamptz)
    ) as reply_stats on true
  ),
  components as (
    select
      measurement.*,
      public.opinion_wilson_lower_bound(
        measurement.message_useful_count,
        greatest(
          measurement.message_exposure_count,
          measurement.message_useful_count
        )
      ) as useful_component,
      public.opinion_wilson_lower_bound(
        measurement.reply_useful_count,
        greatest(
          measurement.reply_exposure_count,
          measurement.reply_useful_count
        )
      ) as reply_component,
      least(
        1::double precision,
        ln(1 + measurement.distinct_reply_authors::double precision) / ln(6)
      ) as breadth_component
    from measurements as measurement
  )
  insert into public.opinion_cycle_message_quality (
    cycle_id,
    message_id,
    root_message_id,
    message_exposure_count,
    message_useful_count,
    reply_exposure_count,
    reply_useful_count,
    distinct_reply_authors,
    useful_component,
    reply_component,
    breadth_component,
    quality_score,
    calculated_at
  )
  select
    component.cycle_id,
    component.message_id,
    component.root_message_id,
    component.message_exposure_count,
    component.message_useful_count,
    component.reply_exposure_count,
    component.reply_useful_count,
    component.distinct_reply_authors,
    component.useful_component,
    component.reply_component,
    component.breadth_component,
    0.70 * component.useful_component
      + 0.20 * component.reply_component
      + 0.10 * component.breadth_component,
    now()
  from components as component;

  get diagnostics refreshed_count = row_count;
  return refreshed_count;
end;
$$;

create or replace function public.refresh_active_opinion_cycle_quality()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_row record;
  refreshed_count integer := 0;
begin
  for cycle_row in
    select cycle.id
    from public.opinion_topic_cycles as cycle
    where cycle.status = 'open'
  loop
    refreshed_count := refreshed_count
      + public.refresh_opinion_cycle_quality(cycle_row.id);
  end loop;

  return refreshed_count;
end;
$$;

revoke all on function public.get_opinion_message_embedding_input(uuid)
  from public, anon, authenticated;
revoke all on function public.classify_opinion_message(uuid)
  from public, anon, authenticated;
revoke all on function public.enqueue_opinion_message_embedding()
  from public, anon, authenticated;
revoke all on function public.requeue_opinion_embedding_jobs(boolean)
  from public, anon, authenticated;
revoke all on function public.open_opinion_topic_cycle(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.sync_opinion_topic_cycle()
  from public, anon, authenticated;
revoke all on function public.opinion_wilson_lower_bound(bigint, bigint, double precision)
  from public, anon, authenticated;
revoke all on function public.record_opinion_message_exposures(uuid[])
  from public, anon, authenticated;
revoke all on function public.refresh_opinion_cycle_quality(uuid)
  from public, anon, authenticated;
revoke all on function public.refresh_active_opinion_cycle_quality()
  from public, anon, authenticated;

grant execute on function public.get_opinion_message_embedding_input(uuid)
  to service_role, danaus_opinion_worker;
grant execute on function public.classify_opinion_message(uuid)
  to service_role, danaus_opinion_worker;
grant execute on function public.requeue_opinion_embedding_jobs(boolean)
  to service_role;
grant execute on function public.open_opinion_topic_cycle(uuid, timestamptz)
  to service_role;
grant execute on function public.record_opinion_message_exposures(uuid[])
  to service_role;
grant execute on function public.refresh_opinion_cycle_quality(uuid)
  to service_role;
grant execute on function public.refresh_active_opinion_cycle_quality()
  to service_role;

-- Rebuild message hashes because comments now include their conversational
-- context. Existing test data is removed by setting content_origin = 'test'
-- explicitly in the relevant environment, never by this shared migration.
select public.requeue_opinion_embedding_jobs(true);
