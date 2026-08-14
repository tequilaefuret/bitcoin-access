-- Complementary weak signals for the For-you feed.
--
-- The already validated core rank keeps 92% of the final score. The remaining
-- 8% is intentionally split across three explainable, time-decayed signals:
-- engagement breadth, social proof from followed accounts, and useful replies.

alter table public.for_you_algorithm_settings
  add column if not exists core_score_weight double precision not null default 0.92,
  add column if not exists social_proof_weight double precision not null default 0.03,
  add column if not exists conversation_quality_weight double precision not null default 0.03,
  add column if not exists engagement_breadth_weight double precision not null default 0.02,
  add column if not exists social_proof_saturation double precision not null default 3.0,
  add column if not exists conversation_quality_saturation double precision not null default 5.0,
  add column if not exists engagement_breadth_saturation double precision not null default 8.0;

update public.for_you_algorithm_settings
set
  core_score_weight = 0.92,
  social_proof_weight = 0.03,
  conversation_quality_weight = 0.03,
  engagement_breadth_weight = 0.02,
  social_proof_saturation = 3.0,
  conversation_quality_saturation = 5.0,
  engagement_breadth_saturation = 8.0,
  updated_at = now()
where singleton;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'for_you_algorithm_settings_weak_weights_check'
  ) then
    alter table public.for_you_algorithm_settings
      add constraint for_you_algorithm_settings_weak_weights_check check (
        core_score_weight between 0.80 and 1.0
        and social_proof_weight between 0.0 and 0.10
        and conversation_quality_weight between 0.0 and 0.10
        and engagement_breadth_weight between 0.0 and 0.10
        and abs(
          core_score_weight
          + social_proof_weight
          + conversation_quality_weight
          + engagement_breadth_weight
          - 1.0
        ) < 0.000001
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'for_you_algorithm_settings_weak_saturation_check'
  ) then
    alter table public.for_you_algorithm_settings
      add constraint for_you_algorithm_settings_weak_saturation_check check (
        social_proof_saturation between 1.0 and 20.0
        and conversation_quality_saturation between 1.0 and 50.0
        and engagement_breadth_saturation between 2.0 and 50.0
      );
  end if;
end $$;

-- Logarithmic saturation is deliberately conservative: every additional piece
-- of evidence helps less than the previous one and the result always stays in
-- [0, 1].
create or replace function public.for_you_saturating_log_signal(
  p_signal_weight double precision,
  p_saturation_point double precision
)
returns double precision
language sql
immutable
parallel safe
set search_path = ''
as $$
  select least(
    1.0,
    ln(1.0 + greatest(coalesce(p_signal_weight, 0.0), 0.0))
    / ln(1.0 + greatest(coalesce(p_saturation_point, 1.0), 1.0))
  );
$$;

revoke all on function public.for_you_saturating_log_signal(double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.for_you_saturating_log_signal(double precision, double precision)
  to service_role;

-- Keep the previously tested algorithm as the core retrieval/ranking stage.
-- The wrapper below adds only a small final reranking layer.
do $$
begin
  if to_regprocedure('public.rank_for_you_feed_core(text,integer)') is null then
    alter function public.rank_for_you_feed(text, integer)
      rename to rank_for_you_feed_core;
  end if;
end $$;

revoke all on function public.rank_for_you_feed_core(text, integer)
  from public, anon, authenticated, service_role;

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
  core_candidates as materialized (
    -- Weak signals are intentionally a reranker, not a candidate generator.
    -- Request the full core page so they can reorder every returned position.
    select *
    from public.rank_for_you_feed_core(p_bitcoin_address, 20)
  ),
  candidate_roots as materialized (
    select
      core.message_id,
      core.rank_score as core_rank_score,
      core.candidate_source,
      coalesce(candidate.repost_of, candidate.id) as canonical_message_id,
      root.bitcoin_address as root_author_address
    from core_candidates as core
    join public.messages as candidate on candidate.id = core.message_id
    join public.messages as root
      on root.id = coalesce(candidate.repost_of, candidate.id)
    where candidate.deleted_at is null
      and root.deleted_at is null
  ),
  actor_events as materialized (
    select
      root.canonical_message_id,
      vote.bitcoin_address as actor_address,
      vote.created_at as event_at
    from candidate_roots as root
    join public.message_useful_votes as vote
      on vote.message_id = root.canonical_message_id
    where vote.bitcoin_address <> root.root_author_address
      and vote.bitcoin_address <> p_bitcoin_address

    union all

    select
      root.canonical_message_id,
      reply.bitcoin_address,
      reply.created_at
    from candidate_roots as root
    join public.messages as reply
      on reply.parent_id = root.canonical_message_id
    where reply.deleted_at is null
      and reply.bitcoin_address <> root.root_author_address
      and reply.bitcoin_address <> p_bitcoin_address

    union all

    select
      root.canonical_message_id,
      repost.bitcoin_address,
      repost.created_at
    from candidate_roots as root
    join public.messages as repost
      on repost.repost_of = root.canonical_message_id
    where repost.deleted_at is null
      and repost.bitcoin_address <> root.root_author_address
      and repost.bitcoin_address <> p_bitcoin_address
  ),
  actor_support as materialized (
    -- One person contributes at most once to breadth/social proof. If they took
    -- several actions, only their strongest (most recent) temporal weight is
    -- retained.
    select
      event.canonical_message_id,
      event.actor_address,
      max(public.for_you_temporal_decay(
        event.event_at,
        settings.interaction_decay_days,
        settings.interaction_decay_floor
      )) as actor_weight
    from actor_events as event
    cross join settings
    group by event.canonical_message_id, event.actor_address
  ),
  support_totals as materialized (
    select
      support.canonical_message_id,
      sum(support.actor_weight) as breadth_weight,
      coalesce(sum(support.actor_weight) filter (
        where exists (
          select 1
          from public.follows as followed
          where followed.follower_address = p_bitcoin_address
            and followed.following_address = support.actor_address
        )
      ), 0.0) as social_proof_weight
    from actor_support as support
    group by support.canonical_message_id
  ),
  conversation_quality as materialized (
    -- A Useful received by a direct reply is a lightweight proxy for a useful
    -- conversation. Self-Useful on one's own reply is ignored.
    select
      root.canonical_message_id,
      sum(public.for_you_temporal_decay(
        vote.created_at,
        settings.interaction_decay_days,
        settings.interaction_decay_floor
      )) as useful_reply_weight
    from candidate_roots as root
    join public.messages as reply
      on reply.parent_id = root.canonical_message_id
     and reply.deleted_at is null
    join public.message_useful_votes as vote
      on vote.message_id = reply.id
     and vote.bitcoin_address <> reply.bitcoin_address
    cross join settings
    group by root.canonical_message_id
  ),
  signal_scores as materialized (
    select
      root.*,
      public.for_you_saturating_log_signal(
        coalesce(support.breadth_weight, 0.0),
        settings.engagement_breadth_saturation
      ) as engagement_breadth_score,
      public.for_you_saturating_log_signal(
        coalesce(support.social_proof_weight, 0.0),
        settings.social_proof_saturation
      ) as social_proof_score,
      public.for_you_saturating_log_signal(
        coalesce(conversation.useful_reply_weight, 0.0),
        settings.conversation_quality_saturation
      ) as conversation_quality_score
    from candidate_roots as root
    cross join settings
    left join support_totals as support
      on support.canonical_message_id = root.canonical_message_id
    left join conversation_quality as conversation
      on conversation.canonical_message_id = root.canonical_message_id
  ),
  final_scores as (
    select
      signal.message_id,
      signal.candidate_source,
      settings.core_score_weight * signal.core_rank_score
        + settings.social_proof_weight * signal.social_proof_score
        + settings.conversation_quality_weight * signal.conversation_quality_score
        + settings.engagement_breadth_weight * signal.engagement_breadth_score
        as final_score
    from signal_scores as signal
    cross join settings
  )
  select
    final.message_id,
    final.final_score as rank_score,
    final.candidate_source
  from final_scores as final
  where final.final_score > 0.0
  order by final.final_score desc, final.message_id
  limit greatest(1, least(coalesce(p_limit, 20), 20));
$$;

revoke all on function public.rank_for_you_feed(text, integer)
  from public, anon, authenticated;
grant execute on function public.rank_for_you_feed(text, integer) to service_role;

