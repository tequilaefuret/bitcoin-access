-- Opinion Stage 2: local embeddings, durable jobs and conservative topic matching.
-- Embeddings and uncertain candidates remain server-only.

create extension if not exists vector with schema extensions;
create extension if not exists pgmq;

do $$
begin
  if to_regclass('pgmq.q_opinion_embeddings') is null then
    perform pgmq.create('opinion_embeddings');
  end if;
end;
$$;

create table if not exists public.opinion_classifier_settings (
  singleton boolean primary key default true,
  embedding_model text not null default 'intfloat/multilingual-e5-small',
  min_similarity double precision not null default 0.72,
  min_margin double precision not null default 0.04,
  updated_at timestamptz not null default now(),
  constraint opinion_classifier_settings_singleton_check check (singleton),
  constraint opinion_classifier_settings_similarity_check
    check (min_similarity >= -1 and min_similarity <= 1),
  constraint opinion_classifier_settings_margin_check
    check (min_margin >= 0 and min_margin <= 2)
);

insert into public.opinion_classifier_settings (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.message_embeddings (
  message_id uuid primary key references public.messages(id) on delete cascade,
  content_hash text not null,
  embedding extensions.vector(384),
  model text,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_embeddings_status_check
    check (status in ('pending', 'processing', 'ready', 'error')),
  constraint message_embeddings_attempt_count_check check (attempt_count >= 0)
);

create table if not exists public.opinion_topic_embeddings (
  topic_id uuid primary key references public.opinion_topics(id) on delete cascade,
  content_hash text not null,
  embedding extensions.vector(384),
  model text,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opinion_topic_embeddings_status_check
    check (status in ('pending', 'processing', 'ready', 'error')),
  constraint opinion_topic_embeddings_attempt_count_check check (attempt_count >= 0)
);

create table if not exists public.opinion_message_topic_matches (
  message_id uuid primary key references public.messages(id) on delete cascade,
  topic_id uuid references public.opinion_topics(id) on delete cascade,
  candidate_topic_id uuid references public.opinion_topics(id) on delete set null,
  status text not null,
  similarity_score double precision,
  second_best_score double precision,
  confidence_margin double precision,
  uncertainty_reason text,
  embedding_model text not null,
  classified_at timestamptz not null default now(),
  constraint opinion_message_topic_matches_status_check
    check (status in ('matched', 'uncertain')),
  constraint opinion_message_topic_matches_topic_check
    check (status <> 'matched' or topic_id is not null)
);

create index if not exists message_embeddings_ready_hnsw_idx
  on public.message_embeddings
  using hnsw (embedding extensions.vector_cosine_ops)
  where status = 'ready' and embedding is not null;

create index if not exists opinion_message_topic_matches_feed_idx
  on public.opinion_message_topic_matches
  (topic_id, similarity_score desc, classified_at desc)
  where status = 'matched';

create index if not exists opinion_message_topic_matches_diagnostics_idx
  on public.opinion_message_topic_matches
  (status, uncertainty_reason, classified_at desc);

alter table public.opinion_classifier_settings enable row level security;
alter table public.message_embeddings enable row level security;
alter table public.opinion_topic_embeddings enable row level security;
alter table public.opinion_message_topic_matches enable row level security;

revoke all on table public.opinion_classifier_settings from public, anon, authenticated;
revoke all on table public.message_embeddings from public, anon, authenticated;
revoke all on table public.opinion_topic_embeddings from public, anon, authenticated;
revoke all on table public.opinion_message_topic_matches from public, anon, authenticated;

create or replace function public.enqueue_opinion_message_embedding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_content_hash text;
begin
  if NEW.deleted_at is not null then
    delete from public.opinion_message_topic_matches where message_id = NEW.id;
    delete from public.message_embeddings where message_id = NEW.id;
    return NEW;
  end if;

  if TG_OP = 'UPDATE'
    and NEW.content is not distinct from OLD.content
    and NEW.deleted_at is not distinct from OLD.deleted_at then
    return NEW;
  end if;

  next_content_hash := md5(coalesce(NEW.content, ''));

  insert into public.message_embeddings (
    message_id,
    content_hash,
    status,
    attempt_count,
    last_error,
    updated_at
  )
  values (NEW.id, next_content_hash, 'pending', 0, null, now())
  on conflict (message_id) do update set
    content_hash = excluded.content_hash,
    embedding = null,
    model = null,
    status = 'pending',
    attempt_count = 0,
    last_error = null,
    updated_at = now();

  delete from public.opinion_message_topic_matches where message_id = NEW.id;

  begin
    perform pgmq.send(
      queue_name => 'opinion_embeddings',
      msg => jsonb_build_object(
        'action', 'embed',
        'entity_type', 'message',
        'entity_id', NEW.id,
        'content_hash', next_content_hash
      )
    );
  exception when others then
    update public.message_embeddings
    set status = 'error', last_error = SQLERRM, updated_at = now()
    where message_id = NEW.id;
  end;

  return NEW;
end;
$$;

create or replace function public.enqueue_opinion_topic_embedding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_topic_id uuid;
  next_content_hash text;
begin
  target_topic_id := case when TG_OP = 'DELETE' then OLD.id else NEW.id end;

  if TG_OP = 'DELETE' or NEW.status <> 'active' then
    delete from public.opinion_topic_embeddings where topic_id = target_topic_id;
    delete from public.opinion_message_topic_matches
    where topic_id = target_topic_id or candidate_topic_id = target_topic_id;

    begin
      perform pgmq.send(
        queue_name => 'opinion_embeddings',
        msg => jsonb_build_object('action', 'reclassify_all')
      );
    exception when others then
      null;
    end;

    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;

  if TG_OP = 'UPDATE'
    and NEW.category is not distinct from OLD.category
    and NEW.title is not distinct from OLD.title
    and NEW.question is not distinct from OLD.question
    and NEW.status is not distinct from OLD.status then
    return NEW;
  end if;

  next_content_hash := md5(concat_ws(E'\n', NEW.category, NEW.title, NEW.question));

  insert into public.opinion_topic_embeddings (
    topic_id,
    content_hash,
    status,
    attempt_count,
    last_error,
    updated_at
  )
  values (NEW.id, next_content_hash, 'pending', 0, null, now())
  on conflict (topic_id) do update set
    content_hash = excluded.content_hash,
    embedding = null,
    model = null,
    status = 'pending',
    attempt_count = 0,
    last_error = null,
    updated_at = now();

  delete from public.opinion_message_topic_matches
  where topic_id = NEW.id or candidate_topic_id = NEW.id;

  begin
    perform pgmq.send(
      queue_name => 'opinion_embeddings',
      msg => jsonb_build_object(
        'action', 'embed',
        'entity_type', 'topic',
        'entity_id', NEW.id,
        'content_hash', next_content_hash
      )
    );
  exception when others then
    update public.opinion_topic_embeddings
    set status = 'error', last_error = SQLERRM, updated_at = now()
    where topic_id = NEW.id;
  end;

  return NEW;
end;
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
  second_topic_id uuid;
  best_similarity double precision;
  second_similarity double precision;
  score_margin double precision;
  match_status text;
  match_topic_id uuid;
  uncertainty text;
begin
  select *
  into classifier_settings
  from public.opinion_classifier_settings
  where singleton = true;

  select model
  into message_model
  from public.message_embeddings
  where message_id = p_message_id
    and status = 'ready'
    and embedding is not null;

  if not found then
    delete from public.opinion_message_topic_matches where message_id = p_message_id;
    return jsonb_build_object('status', 'not_ready', 'message_id', p_message_id);
  end if;

  select
    topic_embedding.topic_id,
    1 - (
      topic_embedding.embedding
      operator(extensions.<=>)
      message_embedding.embedding
    )
  into best_topic_id, best_similarity
  from public.opinion_topic_embeddings as topic_embedding
  join public.opinion_topics as topic on topic.id = topic_embedding.topic_id
  join public.message_embeddings as message_embedding
    on message_embedding.message_id = p_message_id
  where topic.status = 'active'
    and topic_embedding.status = 'ready'
    and topic_embedding.embedding is not null
    and topic_embedding.model = message_embedding.model
  order by
    topic_embedding.embedding
    operator(extensions.<=>)
    message_embedding.embedding
  limit 1;

  if best_topic_id is null then
    insert into public.opinion_message_topic_matches (
      message_id,
      topic_id,
      candidate_topic_id,
      status,
      uncertainty_reason,
      embedding_model,
      classified_at
    )
    values (
      p_message_id,
      null,
      null,
      'uncertain',
      'no_active_topic_embeddings',
      message_model,
      now()
    )
    on conflict (message_id) do update set
      topic_id = excluded.topic_id,
      candidate_topic_id = excluded.candidate_topic_id,
      status = excluded.status,
      similarity_score = null,
      second_best_score = null,
      confidence_margin = null,
      uncertainty_reason = excluded.uncertainty_reason,
      embedding_model = excluded.embedding_model,
      classified_at = excluded.classified_at;

    return jsonb_build_object(
      'status', 'uncertain',
      'message_id', p_message_id,
      'reason', 'no_active_topic_embeddings'
    );
  end if;

  select
    topic_embedding.topic_id,
    1 - (
      topic_embedding.embedding
      operator(extensions.<=>)
      message_embedding.embedding
    )
  into second_topic_id, second_similarity
  from public.opinion_topic_embeddings as topic_embedding
  join public.opinion_topics as topic on topic.id = topic_embedding.topic_id
  join public.message_embeddings as message_embedding
    on message_embedding.message_id = p_message_id
  where topic.status = 'active'
    and topic_embedding.status = 'ready'
    and topic_embedding.embedding is not null
    and topic_embedding.model = message_embedding.model
    and topic_embedding.topic_id <> best_topic_id
  order by
    topic_embedding.embedding
    operator(extensions.<=>)
    message_embedding.embedding
  limit 1;

  score_margin := case
    when second_topic_id is null then 2
    else best_similarity - second_similarity
  end;

  if best_similarity < classifier_settings.min_similarity then
    match_status := 'uncertain';
    match_topic_id := null;
    uncertainty := 'below_similarity_threshold';
  elsif score_margin < classifier_settings.min_margin then
    match_status := 'uncertain';
    match_topic_id := null;
    uncertainty := 'ambiguous_between_topics';
  else
    match_status := 'matched';
    match_topic_id := best_topic_id;
    uncertainty := null;
  end if;

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
    match_topic_id,
    best_topic_id,
    match_status,
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
    'status', match_status,
    'message_id', p_message_id,
    'topic_id', match_topic_id,
    'candidate_topic_id', best_topic_id,
    'similarity', best_similarity,
    'second_best_similarity', second_similarity,
    'margin', score_margin,
    'reason', uncertainty
  );
end;
$$;

create or replace function public.reclassify_all_opinion_messages()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  embedding_row record;
  classified_count integer := 0;
begin
  for embedding_row in
    select message_id
    from public.message_embeddings
    where status = 'ready' and embedding is not null
  loop
    perform public.classify_opinion_message(embedding_row.message_id);
    classified_count := classified_count + 1;
  end loop;

  return classified_count;
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
  target_hash text;
  queued_count integer := 0;
begin
  select *
  into classifier_settings
  from public.opinion_classifier_settings
  where singleton = true;

  for topic_row in
    select topic.id, topic.category, topic.title, topic.question
    from public.opinion_topics as topic
    left join public.opinion_topic_embeddings as embedding
      on embedding.topic_id = topic.id
    where topic.status = 'active'
      and (
        p_include_ready
        or embedding.topic_id is null
        or embedding.status <> 'ready'
        or embedding.model is distinct from classifier_settings.embedding_model
      )
  loop
    target_hash := md5(concat_ws(E'\n', topic_row.category, topic_row.title, topic_row.question));

    insert into public.opinion_topic_embeddings (topic_id, content_hash, status)
    values (topic_row.id, target_hash, 'pending')
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
        'content_hash', target_hash
      )
    );
    queued_count := queued_count + 1;
  end loop;

  for message_row in
    select message.id, message.content
    from public.messages as message
    left join public.message_embeddings as embedding
      on embedding.message_id = message.id
    where message.deleted_at is null
      and (
        p_include_ready
        or embedding.message_id is null
        or embedding.status <> 'ready'
        or embedding.model is distinct from classifier_settings.embedding_model
      )
  loop
    target_hash := md5(coalesce(message_row.content, ''));

    insert into public.message_embeddings (message_id, content_hash, status)
    values (message_row.id, target_hash, 'pending')
    on conflict (message_id) do update set
      content_hash = excluded.content_hash,
      embedding = null,
      model = null,
      status = 'pending',
      attempt_count = 0,
      last_error = null,
      updated_at = now();

    delete from public.opinion_message_topic_matches where message_id = message_row.id;

    perform pgmq.send(
      queue_name => 'opinion_embeddings',
      msg => jsonb_build_object(
        'action', 'embed',
        'entity_type', 'message',
        'entity_id', message_row.id,
        'content_hash', target_hash
      )
    );
    queued_count := queued_count + 1;
  end loop;

  return queued_count;
end;
$$;

drop trigger if exists messages_enqueue_opinion_embedding on public.messages;
create trigger messages_enqueue_opinion_embedding
after insert or update of content, deleted_at on public.messages
for each row execute function public.enqueue_opinion_message_embedding();

drop trigger if exists topics_enqueue_opinion_embedding on public.opinion_topics;
create trigger topics_enqueue_opinion_embedding
after insert or update of category, title, question, status or delete on public.opinion_topics
for each row execute function public.enqueue_opinion_topic_embedding();

revoke all on function public.enqueue_opinion_message_embedding()
  from public, anon, authenticated;
revoke all on function public.enqueue_opinion_topic_embedding()
  from public, anon, authenticated;
revoke all on function public.classify_opinion_message(uuid)
  from public, anon, authenticated;
revoke all on function public.reclassify_all_opinion_messages()
  from public, anon, authenticated;
revoke all on function public.requeue_opinion_embedding_jobs(boolean)
  from public, anon, authenticated;

grant execute on function public.classify_opinion_message(uuid) to service_role;
grant execute on function public.reclassify_all_opinion_messages() to service_role;
grant execute on function public.requeue_opinion_embedding_jobs(boolean) to service_role;

-- Backfill active topics first so messages are classified against a complete topic set.
do $$
declare
  topic_row record;
  message_row record;
  target_hash text;
begin
  for topic_row in
    select id, category, title, question
    from public.opinion_topics
    where status = 'active'
  loop
    target_hash := md5(concat_ws(E'\n', topic_row.category, topic_row.title, topic_row.question));

    insert into public.opinion_topic_embeddings (topic_id, content_hash, status)
    values (topic_row.id, target_hash, 'pending')
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
        'content_hash', target_hash
      )
    );
  end loop;

  for message_row in
    select id, content
    from public.messages
    where deleted_at is null
  loop
    target_hash := md5(coalesce(message_row.content, ''));

    insert into public.message_embeddings (message_id, content_hash, status)
    values (message_row.id, target_hash, 'pending')
    on conflict (message_id) do update set
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
        'entity_type', 'message',
        'entity_id', message_row.id,
        'content_hash', target_hash
      )
    );
  end loop;
end;
$$;
