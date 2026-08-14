-- Exponential temporal decay and conservative engagement normalization for
-- every interaction used by the For-you ranker.
--
-- The curve starts at 1.00, reaches 0.01 after 10 days and then stays at that
-- deliberately insignificant floor. An interaction that is one month old and
-- one that is one year old therefore carry the same residual temporal weight.

alter table public.for_you_algorithm_settings
  add column if not exists interaction_decay_days double precision not null default 10.0,
  add column if not exists interaction_decay_floor double precision not null default 0.01,
  add column if not exists engagement_prior_impressions double precision not null default 20.0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'for_you_algorithm_settings_interaction_decay_check'
  ) then
    alter table public.for_you_algorithm_settings
      add constraint for_you_algorithm_settings_interaction_decay_check check (
        interaction_decay_days between 1.0 and 30.0
        and interaction_decay_floor between 0.001 and 0.10
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'for_you_algorithm_settings_engagement_prior_check'
  ) then
    alter table public.for_you_algorithm_settings
      add constraint for_you_algorithm_settings_engagement_prior_check check (
        engagement_prior_impressions between 5.0 and 100.0
      );
  end if;
end $$;

-- Retain enough personal history to make the residual floor meaningful. Only
-- the 100 strongest decayed interactions are hydrated by the ranker.
update public.for_you_algorithm_settings
set
  history_lookback_days = 365,
  interaction_decay_days = 10.0,
  interaction_decay_floor = 0.01,
  engagement_prior_impressions = 20.0,
  updated_at = now()
where singleton;

create or replace function public.for_you_temporal_decay(
  p_event_at timestamptz,
  p_significant_days double precision default 10.0,
  p_floor double precision default 0.01
)
returns double precision
language sql
stable
parallel safe
set search_path = ''
as $$
  select case
    when p_event_at is null then 0.0
    else exp(
      ln(p_floor)
      * least(
          1.0,
          greatest(0.0, extract(epoch from (now() - p_event_at)) / 86400.0)
          / p_significant_days
        )
    )
  end;
$$;

revoke all on function public.for_you_temporal_decay(timestamptz, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.for_you_temporal_decay(timestamptz, double precision, double precision)
  to service_role;

-- Conservative empirical-rate normalization. The prior is equivalent to a
-- configurable number of impressions without engagement. greatest(weight,
-- exposures) keeps the rate bounded even when one reader performs multiple
-- kinds of action after a single impression.
create or replace function public.for_you_normalized_engagement(
  p_engagement_weight double precision,
  p_exposure_weight double precision,
  p_prior_impressions double precision default 20.0
)
returns double precision
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when greatest(coalesce(p_engagement_weight, 0.0), 0.0) = 0.0 then 0.0
    else least(
      1.0,
      greatest(coalesce(p_engagement_weight, 0.0), 0.0)
      / (
          greatest(
            greatest(coalesce(p_engagement_weight, 0.0), 0.0),
            greatest(coalesce(p_exposure_weight, 0.0), 0.0)
          )
          + greatest(coalesce(p_prior_impressions, 20.0), 1.0)
        )
    )
  end;
$$;

revoke all on function public.for_you_normalized_engagement(double precision, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.for_you_normalized_engagement(double precision, double precision, double precision)
  to service_role;

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
    select
      vote.message_id,
      vote.created_at,
      3.0 * public.for_you_temporal_decay(
        vote.created_at,
        settings.interaction_decay_days,
        settings.interaction_decay_floor
      ) as signal_strength
    from public.message_useful_votes as vote
    cross join settings
    where vote.bitcoin_address = p_bitcoin_address
      and vote.created_at >= now() - make_interval(days => settings.history_lookback_days)

    union all

    select
      reply.parent_id,
      reply.created_at,
      2.5 * public.for_you_temporal_decay(
        reply.created_at,
        settings.interaction_decay_days,
        settings.interaction_decay_floor
      )
    from public.messages as reply
    cross join settings
    where reply.bitcoin_address = p_bitcoin_address
      and reply.parent_id is not null
      and reply.deleted_at is null
      and reply.created_at >= now() - make_interval(days => settings.history_lookback_days)

    union all

    select
      repost.repost_of,
      repost.created_at,
      2.0 * public.for_you_temporal_decay(
        repost.created_at,
        settings.interaction_decay_days,
        settings.interaction_decay_floor
      )
    from public.messages as repost
    cross join settings
    where repost.bitcoin_address = p_bitcoin_address
      and repost.repost_of is not null
      and repost.deleted_at is null
      and repost.created_at >= now() - make_interval(days => settings.history_lookback_days)

    union all

    select
      liked.message_id,
      liked.created_at,
      1.5 * public.for_you_temporal_decay(
        liked.created_at,
        settings.interaction_decay_days,
        settings.interaction_decay_floor
      )
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
    order by signal_strength desc, last_signal_at desc
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
    -- A current follow remains a structural network choice. Unlike engagement
    -- events, it does not age while the relationship is active.
    select followed.following_address as author_address, 4.0::double precision as signal_strength
    from public.follows as followed
    where followed.follower_address = p_bitcoin_address

    union all

    select target.bitcoin_address, history.signal_strength
    from interest_history as history
    join public.messages as target on target.id = history.message_id
    where target.bitcoin_address <> p_bitcoin_address

    union all

    select
      target.bitcoin_address,
      -4.0 * public.for_you_temporal_decay(
        disliked.created_at,
        settings.interaction_decay_days,
        settings.interaction_decay_floor
      )
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
  useful_weights as materialized (
    select
      vote.message_id,
      sum(public.for_you_temporal_decay(
        vote.created_at,
        settings.interaction_decay_days,
        settings.interaction_decay_floor
      )) as useful_weight
    from public.message_useful_votes as vote
    join candidate_sources as candidate on candidate.id = vote.message_id
    cross join settings
    group by vote.message_id
  ),
  reply_weights as materialized (
    select
      reply.parent_id as message_id,
      sum(public.for_you_temporal_decay(
        reply.created_at,
        settings.interaction_decay_days,
        settings.interaction_decay_floor
      )) as reply_weight
    from public.messages as reply
    join candidate_sources as candidate on candidate.id = reply.parent_id
    cross join settings
    where reply.deleted_at is null
    group by reply.parent_id
  ),
  repost_weights as materialized (
    select
      repost.repost_of as message_id,
      sum(public.for_you_temporal_decay(
        repost.created_at,
        settings.interaction_decay_days,
        settings.interaction_decay_floor
      )) as repost_weight
    from public.messages as repost
    cross join settings
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
      count(*)::integer as impression_count,
      sum(public.for_you_temporal_decay(
        impression.served_at,
        settings.interaction_decay_days,
        settings.interaction_decay_floor
      )) as exposure_weight
    from public.for_you_impressions as impression
    join public.messages as message on message.id = impression.message_id
    cross join settings
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
      coalesce(useful.useful_weight, 0) as useful_weight,
      coalesce(reply.reply_weight, 0) as reply_weight,
      coalesce(repost.repost_weight, 0) as repost_weight,
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
      coalesce(impression.impression_count, 0) as impression_count,
      coalesce(impression.exposure_weight, 0) as exposure_weight
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
    left join useful_weights as useful
      on useful.message_id = coalesce(message.repost_of, message.id)
    left join reply_weights as reply
      on reply.message_id = coalesce(message.repost_of, message.id)
    left join repost_weights as repost
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
      -- Decayed multi-action evidence is normalized against decayed For-you
      -- exposure opportunity and a conservative small-network prior.
      public.for_you_normalized_engagement(
        hydrated.useful_weight * 1.7
          + hydrated.reply_weight * 1.2
          + hydrated.repost_weight * 1.5,
        hydrated.exposure_weight,
        settings.engagement_prior_impressions
      ) as engagement_score,
      public.for_you_temporal_decay(
        hydrated.created_at,
        settings.interaction_decay_days,
        settings.interaction_decay_floor
      ) as freshness_score,
      tanh(hydrated.author_affinity / 6.0) as affinity_score,
      case
        when hydrated.last_served_at is null then 1.0
        when hydrated.last_served_at >= now() - interval '6 hours' then 0.00
        when hydrated.last_served_at >= now() - interval '1 day' then 0.20
        when hydrated.last_served_at >= now() - interval '7 days' then 0.55
        else 0.90
      end as served_multiplier
    from hydrated
    cross join settings
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

revoke all on function public.rank_for_you_feed(text, integer)
  from public, anon, authenticated;
grant execute on function public.rank_for_you_feed(text, integer) to service_role;
