-- Danaus "For you" feed.
--
-- This is a small-network adaptation of the open-source X recommendation
-- pipeline (Apache-2.0): query hydration, in-network + out-of-network
-- candidate retrieval, multi-signal scoring, served-history attenuation and
-- author diversity. Danaus reuses its local 384-dimensional message
-- embeddings; it does not require the multi-GPU Phoenix transformer.

create table if not exists public.for_you_algorithm_settings (
  singleton boolean primary key default true,
  candidate_lookback_days integer not null default 30,
  history_lookback_days integer not null default 90,
  semantic_weight double precision not null default 0.34,
  author_affinity_weight double precision not null default 0.22,
  engagement_weight double precision not null default 0.18,
  freshness_weight double precision not null default 0.14,
  in_network_weight double precision not null default 0.08,
  exploration_weight double precision not null default 0.04,
  author_diversity_decay double precision not null default 0.65,
  author_diversity_floor double precision not null default 0.35,
  updated_at timestamptz not null default now(),
  constraint for_you_algorithm_settings_singleton_check check (singleton),
  constraint for_you_algorithm_settings_lookback_check check (
    candidate_lookback_days between 1 and 90
    and history_lookback_days between 7 and 365
  ),
  constraint for_you_algorithm_settings_weights_check check (
    semantic_weight >= 0
    and author_affinity_weight >= 0
    and engagement_weight >= 0
    and freshness_weight >= 0
    and in_network_weight >= 0
    and exploration_weight >= 0
  ),
  constraint for_you_algorithm_settings_diversity_check check (
    author_diversity_decay > 0 and author_diversity_decay <= 1
    and author_diversity_floor >= 0 and author_diversity_floor <= 1
  )
);

insert into public.for_you_algorithm_settings (singleton)
values (true)
on conflict (singleton) do nothing;

-- One row per actually served post. request_id makes retries idempotent while
-- preserving the sequence that the reader saw.
create table if not exists public.for_you_impressions (
  bitcoin_address text not null
    references public.user_balances(bitcoin_address) on delete cascade,
  request_id uuid not null,
  message_id uuid not null references public.messages(id) on delete cascade,
  rank_position integer not null,
  served_at timestamptz not null default now(),
  primary key (bitcoin_address, request_id, message_id),
  constraint for_you_impressions_rank_check check (rank_position between 0 and 99)
);

create index if not exists for_you_impressions_reader_served_idx
  on public.for_you_impressions (bitcoin_address, served_at desc);

create index if not exists for_you_impressions_reader_message_idx
  on public.for_you_impressions (bitcoin_address, message_id, served_at desc);

-- X uses predicted negative actions. Danaus starts with the clearest explicit
-- equivalent and can add mute/block/report later without changing the feed API.
create table if not exists public.for_you_feedback (
  bitcoin_address text not null
    references public.user_balances(bitcoin_address) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  feedback_kind text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (bitcoin_address, message_id),
  constraint for_you_feedback_kind_check check (feedback_kind in ('not_interested'))
);

create index if not exists for_you_feedback_reader_updated_idx
  on public.for_you_feedback (bitcoin_address, updated_at desc);

alter table public.for_you_algorithm_settings enable row level security;
alter table public.for_you_impressions enable row level security;
alter table public.for_you_feedback enable row level security;

revoke all on table public.for_you_algorithm_settings from public, anon, authenticated;
revoke all on table public.for_you_impressions from public, anon, authenticated;
revoke all on table public.for_you_feedback from public, anon, authenticated;

grant select, update on table public.for_you_algorithm_settings to service_role;
grant select, insert, delete on table public.for_you_impressions to service_role;
grant select, insert, update, delete on table public.for_you_feedback to service_role;

create or replace function public.rank_for_you_feed(
  p_bitcoin_address text,
  p_limit integer default 20
)
returns table (
  message_id uuid,
  rank_score double precision,
  candidate_source text
)
language sql
stable
security definer
set search_path = ''
as $$
  with
  settings as materialized (
    select *
    from public.for_you_algorithm_settings
    where singleton
    limit 1
  ),
  positive_history_events as materialized (
    select vote.message_id, vote.created_at, 3.0::double precision as signal_strength
    from public.message_useful_votes as vote
    cross join settings
    where vote.bitcoin_address = p_bitcoin_address
      and vote.created_at >= now() - make_interval(days => settings.history_lookback_days)

    union all

    select reply.parent_id, reply.created_at, 2.5::double precision
    from public.messages as reply
    cross join settings
    where reply.bitcoin_address = p_bitcoin_address
      and reply.parent_id is not null
      and reply.deleted_at is null
      and reply.created_at >= now() - make_interval(days => settings.history_lookback_days)

    union all

    select repost.repost_of, repost.created_at, 2.0::double precision
    from public.messages as repost
    cross join settings
    where repost.bitcoin_address = p_bitcoin_address
      and repost.repost_of is not null
      and repost.deleted_at is null
      and repost.created_at >= now() - make_interval(days => settings.history_lookback_days)

    union all

    select liked.message_id, liked.created_at, 1.5::double precision
    from public.message_likes as liked
    cross join settings
    where liked.bitcoin_address = p_bitcoin_address
      and liked.created_at >= now() - make_interval(days => settings.history_lookback_days)
  ),
  interest_history as materialized (
    select
      event.message_id,
      sum(event.signal_strength) as signal_strength,
      max(event.created_at) as last_signal_at
    from positive_history_events as event
    where event.message_id is not null
    group by event.message_id
    order by last_signal_at desc
    limit 100
  ),
  interest_vector as materialized (
    select extensions.avg(embedding.embedding) as embedding
    from interest_history as history
    join public.message_embeddings as embedding
      on embedding.message_id = history.message_id
     and embedding.status = 'ready'
     and embedding.embedding is not null
  ),
  author_signal_events as materialized (
    select followed.following_address as author_address, 4.0::double precision as signal_strength
    from public.follows as followed
    where followed.follower_address = p_bitcoin_address

    union all

    select target.bitcoin_address, history.signal_strength
    from interest_history as history
    join public.messages as target on target.id = history.message_id
    where target.bitcoin_address <> p_bitcoin_address

    union all

    select target.bitcoin_address, -4.0::double precision
    from public.message_dislikes as disliked
    join public.messages as target on target.id = disliked.message_id
    cross join settings
    where disliked.bitcoin_address = p_bitcoin_address
      and disliked.created_at >= now() - make_interval(days => settings.history_lookback_days)
  ),
  author_affinity as materialized (
    select author_address, sum(signal_strength) as affinity
    from author_signal_events
    group by author_address
  ),
  in_network_candidates as materialized (
    select message.id
    from public.follows as followed
    join public.messages as message
      on message.bitcoin_address = followed.following_address
    cross join settings
    where followed.follower_address = p_bitcoin_address
      and message.parent_id is null
      and message.deleted_at is null
      and message.created_at >= now() - make_interval(days => settings.candidate_lookback_days)
    order by message.created_at desc
    limit 250
  ),
  semantic_candidates as materialized (
    select nearest.id
    from interest_vector as interest
    cross join settings
    cross join lateral (
      select message.id
      from public.message_embeddings as embedding
      join public.messages as message on message.id = embedding.message_id
      where interest.embedding is not null
        and embedding.status = 'ready'
        and embedding.embedding is not null
        and message.parent_id is null
        and message.deleted_at is null
        and message.bitcoin_address <> p_bitcoin_address
        and message.created_at >= now() - make_interval(days => settings.candidate_lookback_days)
      order by embedding.embedding operator(extensions.<=>) interest.embedding
      limit 250
    ) as nearest
  ),
  global_candidates as materialized (
    select message.id
    from public.messages as message
    cross join settings
    where message.parent_id is null
      and message.deleted_at is null
      and message.bitcoin_address <> p_bitcoin_address
      and message.created_at >= now() - make_interval(days => settings.candidate_lookback_days)
    order by
      (coalesce(message.useful_count, 0) * 2) desc,
      message.created_at desc
    limit 400
  ),
  candidate_sources as materialized (
    select source.id, string_agg(source.source, '+' order by source.source) as source
    from (
      select id, 'in_network'::text as source from in_network_candidates
      union all
      select id, 'semantic'::text from semantic_candidates
      union all
      select id, 'global'::text from global_candidates
    ) as source
    group by source.id
  ),
  reply_counts as materialized (
    select reply.parent_id as message_id, count(*)::double precision as reply_count
    from public.messages as reply
    join candidate_sources as candidate on candidate.id = reply.parent_id
    where reply.deleted_at is null
    group by reply.parent_id
  ),
  repost_counts as materialized (
    select repost.repost_of as message_id, count(*)::double precision as repost_count
    from public.messages as repost
    where repost.deleted_at is null
      and repost.repost_of is not null
      and exists (
        select 1
        from candidate_sources as source
        join public.messages as candidate on candidate.id = source.id
        where coalesce(candidate.repost_of, candidate.id) = repost.repost_of
      )
    group by repost.repost_of
  ),
  impression_history as materialized (
    select
      coalesce(message.repost_of, message.id) as canonical_message_id,
      max(impression.served_at) as last_served_at,
      count(*)::integer as impression_count
    from public.for_you_impressions as impression
    join public.messages as message on message.id = impression.message_id
    where impression.bitcoin_address = p_bitcoin_address
      and impression.served_at >= now() - interval '30 days'
    group by coalesce(message.repost_of, message.id)
  ),
  hydrated as materialized (
    select
      message.id,
      message.bitcoin_address,
      coalesce(message.repost_of, message.id) as canonical_message_id,
      message.created_at,
      source.source,
      coalesce(message.useful_count, 0)::double precision as useful_count,
      coalesce(reply.reply_count, 0) as reply_count,
      coalesce(repost.repost_count, 0) as repost_count,
      coalesce(affinity.affinity, 0) as author_affinity,
      exists (
        select 1
        from public.follows as followed
        where followed.follower_address = p_bitcoin_address
          and followed.following_address = message.bitcoin_address
      ) as in_network,
      case
        when interest.embedding is null or embedding.embedding is null then 0.0
        else greatest(
          0.0,
          least(
            1.0,
            1.0 - (embedding.embedding operator(extensions.<=>) interest.embedding)
          )
        )
      end as semantic_similarity,
      impression.last_served_at,
      coalesce(impression.impression_count, 0) as impression_count
    from candidate_sources as source
    join public.messages as message on message.id = source.id
    cross join interest_vector as interest
    left join public.message_embeddings as embedding
      on embedding.message_id = case
        when message.repost_kind = 'simple' and message.repost_of is not null
          then message.repost_of
        else message.id
      end
     and embedding.status = 'ready'
    left join author_affinity as affinity
      on affinity.author_address = message.bitcoin_address
    left join reply_counts as reply
      on reply.message_id = coalesce(message.repost_of, message.id)
    left join repost_counts as repost
      on repost.message_id = coalesce(message.repost_of, message.id)
    left join impression_history as impression
      on impression.canonical_message_id = coalesce(message.repost_of, message.id)
    where message.bitcoin_address <> p_bitcoin_address
    and not exists (
      select 1
      from interest_history as history
      where history.message_id in (message.id, coalesce(message.repost_of, message.id))
    )
    and not exists (
      select 1
      from public.message_dislikes as disliked
      where disliked.bitcoin_address = p_bitcoin_address
        and disliked.message_id in (message.id, coalesce(message.repost_of, message.id))
    )
    and not exists (
      select 1
      from public.for_you_feedback as feedback
      where feedback.bitcoin_address = p_bitcoin_address
        and feedback.message_id in (message.id, coalesce(message.repost_of, message.id))
        and feedback.feedback_kind = 'not_interested'
    )
  ),
  signal_scores as materialized (
    select
      hydrated.*,
      -- Multi-action proxy: Useful, replies and reposts are Danaus's current
      -- high-intent equivalents of Phoenix engagement heads.
      1.0 - exp(-(
        hydrated.useful_count * 1.7
        + hydrated.reply_count * 1.2
        + hydrated.repost_count * 1.5
      ) / 8.0) as engagement_score,
      exp(-greatest(
        0.0,
        extract(epoch from (now() - hydrated.created_at)) / 3600.0
      ) / 36.0) as freshness_score,
      tanh(hydrated.author_affinity / 6.0) as affinity_score,
      case
        when hydrated.last_served_at is null then 1.0
        when hydrated.last_served_at >= now() - interval '6 hours' then 0.00
        when hydrated.last_served_at >= now() - interval '1 day' then 0.20
        when hydrated.last_served_at >= now() - interval '7 days' then 0.55
        else 0.90
      end as served_multiplier
    from hydrated
  ),
  weighted as materialized (
    select
      score.*,
      (
        settings.semantic_weight * score.semantic_similarity
        + settings.author_affinity_weight * score.affinity_score
        + settings.engagement_weight * score.engagement_score
        + settings.freshness_weight * score.freshness_score
        + settings.in_network_weight * case when score.in_network then 1.0 else 0.0 end
        + settings.exploration_weight * case
            when not score.in_network and score.semantic_similarity >= 0.50 then 1.0
            else 0.0
          end
      ) * score.served_multiplier as pre_diversity_score
    from signal_scores as score
    cross join settings
  ),
  canonical_dedup as materialized (
    select ranked.*
    from (
      select
        weighted.*,
        row_number() over (
          partition by weighted.canonical_message_id
          order by weighted.pre_diversity_score desc, weighted.created_at desc, weighted.id
        ) as canonical_rank
      from weighted
    ) as ranked
    where ranked.canonical_rank = 1
  ),
  diversity_context as materialized (
    select
      dedup.*,
      row_number() over (
        partition by dedup.bitcoin_address
        order by dedup.pre_diversity_score desc, dedup.created_at desc, dedup.id
      ) - 1 as prior_author_posts
    from canonical_dedup as dedup
  ),
  final_scores as (
    select
      context.id,
      context.source,
      context.pre_diversity_score * (
        (1.0 - settings.author_diversity_floor)
        * power(settings.author_diversity_decay, context.prior_author_posts)
        + settings.author_diversity_floor
      ) as final_score
    from diversity_context as context
    cross join settings
  )
  select
    final.id as message_id,
    final.final_score as rank_score,
    final.source as candidate_source
  from final_scores as final
  where final.final_score > 0.0
  order by final.final_score desc, final.id
  limit greatest(1, least(coalesce(p_limit, 20), 20));
$$;

create or replace function public.record_for_you_impressions(
  p_bitcoin_address text,
  p_request_id uuid,
  p_message_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer := 0;
begin
  if p_bitcoin_address is null or p_request_id is null then
    raise exception 'Contexte For you incomplet';
  end if;

  if coalesce(cardinality(p_message_ids), 0) > 20 then
    raise exception 'Lot For you trop grand';
  end if;

  delete from public.for_you_impressions
  where bitcoin_address = p_bitcoin_address
    and served_at < now() - interval '90 days';

  insert into public.for_you_impressions (
    bitcoin_address,
    request_id,
    message_id,
    rank_position,
    served_at
  )
  select
    p_bitcoin_address,
    p_request_id,
    ranked.message_id,
    ranked.ordinality::integer - 1,
    now()
  from unnest(coalesce(p_message_ids, array[]::uuid[]))
    with ordinality as ranked(message_id, ordinality)
  join public.messages as message
    on message.id = ranked.message_id and message.deleted_at is null
  on conflict (bitcoin_address, request_id, message_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.record_for_you_feedback(
  p_bitcoin_address text,
  p_message_id uuid,
  p_feedback_kind text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_message_id uuid;
begin
  if p_feedback_kind <> 'not_interested' then
    raise exception 'Signal For you invalide';
  end if;

  select coalesce(message.repost_of, message.id)
  into canonical_message_id
  from public.messages as message
  where message.id = p_message_id and message.deleted_at is null;

  if canonical_message_id is null then
    raise exception 'Publication introuvable';
  end if;

  insert into public.for_you_feedback (
    bitcoin_address,
    message_id,
    feedback_kind,
    created_at,
    updated_at
  ) values (
    p_bitcoin_address,
    canonical_message_id,
    p_feedback_kind,
    now(),
    now()
  )
  on conflict (bitcoin_address, message_id) do update set
    feedback_kind = excluded.feedback_kind,
    updated_at = now();
end;
$$;

revoke all on function public.rank_for_you_feed(text, integer)
  from public, anon, authenticated;
revoke all on function public.record_for_you_impressions(text, uuid, uuid[])
  from public, anon, authenticated;
revoke all on function public.record_for_you_feedback(text, uuid, text)
  from public, anon, authenticated;

grant execute on function public.rank_for_you_feed(text, integer) to service_role;
grant execute on function public.record_for_you_impressions(text, uuid, uuid[]) to service_role;
grant execute on function public.record_for_you_feedback(text, uuid, text) to service_role;
