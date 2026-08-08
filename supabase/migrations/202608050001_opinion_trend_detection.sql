-- Opinion Stage 3: multi-window trend detection and topic lifecycle.
-- The existing Docker worker refreshes these private metrics every five minutes.

create table if not exists public.opinion_trend_window_settings (
  window_minutes integer primary key,
  priority integer not null unique,
  hot_min_authors integer not null,
  hot_min_root_threads integer not null,
  hot_min_messages integer not null,
  hot_min_voters integer not null,
  target_authors double precision not null,
  target_root_threads double precision not null,
  target_messages double precision not null,
  target_voters double precision not null,
  updated_at timestamptz not null default now(),
  constraint opinion_trend_window_settings_window_check
    check (window_minutes in (60, 360, 1440, 10080)),
  constraint opinion_trend_window_settings_priority_check check (priority > 0),
  constraint opinion_trend_window_settings_minimums_check check (
    hot_min_authors > 0
    and hot_min_root_threads > 0
    and hot_min_messages > 0
    and hot_min_voters > 0
  ),
  constraint opinion_trend_window_settings_targets_check check (
    target_authors > 0
    and target_root_threads > 0
    and target_messages > 0
    and target_voters > 0
  )
);

insert into public.opinion_trend_window_settings (
  window_minutes,
  priority,
  hot_min_authors,
  hot_min_root_threads,
  hot_min_messages,
  hot_min_voters,
  target_authors,
  target_root_threads,
  target_messages,
  target_voters
)
values
  (60, 1, 3, 2, 4, 5, 6, 3, 8, 8),
  (360, 2, 5, 3, 7, 10, 10, 5, 14, 15),
  (1440, 3, 8, 4, 12, 20, 16, 8, 24, 30),
  (10080, 4, 15, 6, 20, 40, 30, 15, 48, 60)
on conflict (window_minutes) do update set
  priority = excluded.priority,
  hot_min_authors = excluded.hot_min_authors,
  hot_min_root_threads = excluded.hot_min_root_threads,
  hot_min_messages = excluded.hot_min_messages,
  hot_min_voters = excluded.hot_min_voters,
  target_authors = excluded.target_authors,
  target_root_threads = excluded.target_root_threads,
  target_messages = excluded.target_messages,
  target_voters = excluded.target_voters,
  updated_at = now();

create table if not exists public.opinion_topic_trend_windows (
  topic_id uuid not null references public.opinion_topics(id) on delete cascade,
  window_minutes integer not null references public.opinion_trend_window_settings(window_minutes),
  message_count integer not null default 0,
  root_thread_count integer not null default 0,
  distinct_author_count integer not null default 0,
  useful_vote_count integer not null default 0,
  distinct_voter_count integer not null default 0,
  previous_message_count integer not null default 0,
  previous_root_thread_count integer not null default 0,
  previous_distinct_author_count integer not null default 0,
  previous_useful_vote_count integer not null default 0,
  previous_distinct_voter_count integer not null default 0,
  window_score double precision not null default 0,
  previous_window_score double precision not null default 0,
  acceleration_ratio double precision not null default 1,
  first_root_at timestamptz,
  last_activity_at timestamptz,
  calculated_at timestamptz not null default now(),
  primary key (topic_id, window_minutes),
  constraint opinion_topic_trend_windows_counts_check check (
    message_count >= 0
    and root_thread_count >= 0
    and distinct_author_count >= 0
    and useful_vote_count >= 0
    and distinct_voter_count >= 0
    and previous_message_count >= 0
    and previous_root_thread_count >= 0
    and previous_distinct_author_count >= 0
    and previous_useful_vote_count >= 0
    and previous_distinct_voter_count >= 0
  ),
  constraint opinion_topic_trend_windows_scores_check check (
    window_score between 0 and 100
    and previous_window_score between 0 and 100
    and acceleration_ratio between 0 and 10
  )
);

create index if not exists opinion_topic_trend_windows_ranking_idx
  on public.opinion_topic_trend_windows
  (window_minutes, window_score desc, acceleration_ratio desc);

create table if not exists public.opinion_topic_trends (
  topic_id uuid primary key references public.opinion_topics(id) on delete cascade,
  cycle_id uuid references public.opinion_topic_cycles(id) on delete set null,
  lifecycle_status text not null default 'emerging',
  dominant_window_minutes integer references public.opinion_trend_window_settings(window_minutes),
  trend_score double precision not null default 0,
  acceleration_ratio double precision not null default 1,
  last_activity_at timestamptz,
  first_detected_at timestamptz,
  became_hot_at timestamptz,
  declining_at timestamptz,
  archived_at timestamptz,
  status_since timestamptz not null default now(),
  calculated_at timestamptz not null default now(),
  constraint opinion_topic_trends_lifecycle_check
    check (lifecycle_status in ('emerging', 'hot', 'declining', 'archived')),
  constraint opinion_topic_trends_score_check check (trend_score between 0 and 100),
  constraint opinion_topic_trends_acceleration_check
    check (acceleration_ratio between 0 and 10)
);

create index if not exists opinion_topic_trends_feed_idx
  on public.opinion_topic_trends (
    lifecycle_status,
    dominant_window_minutes,
    trend_score desc,
    acceleration_ratio desc
  );

create index if not exists message_useful_votes_created_at_message_idx
  on public.message_useful_votes (created_at desc, message_id);

alter table public.opinion_trend_window_settings enable row level security;
alter table public.opinion_topic_trend_windows enable row level security;
alter table public.opinion_topic_trends enable row level security;

revoke all on table public.opinion_trend_window_settings
  from public, anon, authenticated;
revoke all on table public.opinion_topic_trend_windows
  from public, anon, authenticated;
revoke all on table public.opinion_topic_trends
  from public, anon, authenticated;

-- Saturating score shared by all windows. Every wallet has the same weight;
-- balances and exposure counts are deliberately absent from trend detection.
create or replace function public.opinion_trend_signal_score(
  p_distinct_authors integer,
  p_root_threads integer,
  p_messages integer,
  p_distinct_voters integer,
  p_target_authors double precision,
  p_target_root_threads double precision,
  p_target_messages double precision,
  p_target_voters double precision
)
returns double precision
language sql
immutable
parallel safe
set search_path = ''
as $$
  select greatest(
    0::double precision,
    least(
      100::double precision,
      100 * (
        0.35 * (1 - exp(-greatest(coalesce(p_distinct_authors, 0), 0) / p_target_authors))
        + 0.20 * (1 - exp(-greatest(coalesce(p_root_threads, 0), 0) / p_target_root_threads))
        + 0.15 * (1 - exp(-greatest(coalesce(p_messages, 0), 0) / p_target_messages))
        + 0.30 * (1 - exp(-greatest(coalesce(p_distinct_voters, 0), 0) / p_target_voters))
      )
    )
  );
$$;

create or replace function public.refresh_opinion_trends(
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  topic_row record;
  selected_window integer;
  selected_score double precision;
  selected_acceleration double precision;
  is_hot boolean;
  has_activity boolean;
  next_status text;
  active_cycle_id uuid;
  active_cycle_starts_at timestamptz;
  cycle_changed boolean;
  next_first_detected_at timestamptz;
  next_became_hot_at timestamptz;
  next_declining_at timestamptz;
  next_archived_at timestamptz;
  next_status_since timestamptz;
  state_counts jsonb;
begin
  if p_as_of is null then
    raise exception 'Trend calculation time cannot be null';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('opinion_trend_refresh', 0));

  delete from public.opinion_topic_trend_windows as trend_window
  where not exists (
    select 1
    from public.opinion_topics as topic
    where topic.id = trend_window.topic_id
      and topic.status = 'active'
  );

  delete from public.opinion_topic_trends as trend
  where not exists (
    select 1
    from public.opinion_topics as topic
    where topic.id = trend.topic_id
      and topic.status = 'active'
  );

  with active_topics as (
    select
      topic.id as topic_id,
      cycle.id as open_cycle_id,
      cycle.starts_at as open_cycle_starts_at
    from public.opinion_topics as topic
    left join public.opinion_topic_cycles as cycle
      on cycle.topic_id = topic.id
      and cycle.status = 'open'
    where topic.status = 'active'
  ),
  raw_messages as (
    select
      active_topic.topic_id,
      message.id as message_id,
      message.parent_id,
      message.bitcoin_address,
      message.created_at,
      embedding_input.root_message_id,
      root_message.created_at as root_created_at,
      md5(
        case
          when message.parent_id is null then
            regexp_replace(lower(btrim(coalesce(message.content, ''))), '\s+', ' ', 'g')
          else
            embedding_input.root_message_id::text
            || E'\n'
            || regexp_replace(lower(btrim(coalesce(message.content, ''))), '\s+', ' ', 'g')
        end
      ) as duplicate_key
    from active_topics as active_topic
    join public.opinion_message_topic_scores as score
      on score.topic_id = active_topic.topic_id
      and score.accepted
    join public.messages as message on message.id = score.message_id
    cross join lateral public.get_opinion_message_embedding_input(message.id)
      as embedding_input
    join public.messages as root_message
      on root_message.id = embedding_input.root_message_id
    where message.deleted_at is null
      and root_message.deleted_at is null
      and message.content_origin <> 'test'
      and root_message.content_origin <> 'test'
      and message.repost_of is null
      and message.created_at < p_as_of
      and message.created_at >= p_as_of - interval '14 days'
      and (
        (
          active_topic.open_cycle_id is not null
          and message.created_at >= active_topic.open_cycle_starts_at
          and root_message.created_at >= active_topic.open_cycle_starts_at
        )
        or (
          active_topic.open_cycle_id is null
          and message.created_at >= p_as_of - interval '7 days'
          and root_message.created_at >= p_as_of - interval '7 days'
        )
      )
  ),
  ranked_messages as (
    select
      raw_message.*,
      row_number() over (
        partition by raw_message.topic_id, raw_message.duplicate_key
        order by raw_message.created_at, raw_message.message_id
      ) as duplicate_rank
    from raw_messages as raw_message
  ),
  deduplicated_messages as materialized (
    select ranked_message.*
    from ranked_messages as ranked_message
    where ranked_message.duplicate_rank = 1
  ),
  topic_windows as (
    select
      topic.id as topic_id,
      setting.*,
      make_interval(mins => setting.window_minutes) as window_interval
    from public.opinion_topics as topic
    cross join public.opinion_trend_window_settings as setting
    where topic.status = 'active'
  ),
  message_metrics as (
    select
      topic_window.topic_id,
      topic_window.window_minutes,
      count(message.message_id) filter (
        where message.created_at >= p_as_of - topic_window.window_interval
      )::integer as message_count,
      count(distinct message.root_message_id) filter (
        where message.created_at >= p_as_of - topic_window.window_interval
      )::integer as root_thread_count,
      count(distinct message.bitcoin_address) filter (
        where message.created_at >= p_as_of - topic_window.window_interval
      )::integer as distinct_author_count,
      count(message.message_id) filter (
        where message.created_at < p_as_of - topic_window.window_interval
          and message.created_at >= p_as_of - 2 * topic_window.window_interval
      )::integer as previous_message_count,
      count(distinct message.root_message_id) filter (
        where message.created_at < p_as_of - topic_window.window_interval
          and message.created_at >= p_as_of - 2 * topic_window.window_interval
      )::integer as previous_root_thread_count,
      count(distinct message.bitcoin_address) filter (
        where message.created_at < p_as_of - topic_window.window_interval
          and message.created_at >= p_as_of - 2 * topic_window.window_interval
      )::integer as previous_distinct_author_count,
      min(message.root_created_at) filter (
        where message.created_at >= p_as_of - topic_window.window_interval
      ) as first_root_at,
      max(message.created_at) filter (
        where message.created_at >= p_as_of - topic_window.window_interval
      ) as last_message_at
    from topic_windows as topic_window
    left join deduplicated_messages as message
      on message.topic_id = topic_window.topic_id
      and message.created_at >= p_as_of - 2 * topic_window.window_interval
    group by topic_window.topic_id, topic_window.window_minutes
  ),
  vote_metrics as (
    select
      topic_window.topic_id,
      topic_window.window_minutes,
      count(vote.id) filter (
        where vote.created_at >= p_as_of - topic_window.window_interval
      )::integer as useful_vote_count,
      count(distinct vote.bitcoin_address) filter (
        where vote.created_at >= p_as_of - topic_window.window_interval
      )::integer as distinct_voter_count,
      count(vote.id) filter (
        where vote.created_at < p_as_of - topic_window.window_interval
          and vote.created_at >= p_as_of - 2 * topic_window.window_interval
      )::integer as previous_useful_vote_count,
      count(distinct vote.bitcoin_address) filter (
        where vote.created_at < p_as_of - topic_window.window_interval
          and vote.created_at >= p_as_of - 2 * topic_window.window_interval
      )::integer as previous_distinct_voter_count,
      max(vote.created_at) filter (
        where vote.created_at >= p_as_of - topic_window.window_interval
      ) as last_vote_at
    from topic_windows as topic_window
    left join deduplicated_messages as message
      on message.topic_id = topic_window.topic_id
    left join public.message_useful_votes as vote
      on vote.message_id = message.message_id
      and vote.created_at >= p_as_of - 2 * topic_window.window_interval
      and vote.created_at < p_as_of
    group by topic_window.topic_id, topic_window.window_minutes
  ),
  measured as (
    select
      topic_window.topic_id,
      topic_window.window_minutes,
      coalesce(message_metric.message_count, 0) as message_count,
      coalesce(message_metric.root_thread_count, 0) as root_thread_count,
      coalesce(message_metric.distinct_author_count, 0) as distinct_author_count,
      coalesce(vote_metric.useful_vote_count, 0) as useful_vote_count,
      coalesce(vote_metric.distinct_voter_count, 0) as distinct_voter_count,
      coalesce(message_metric.previous_message_count, 0) as previous_message_count,
      coalesce(message_metric.previous_root_thread_count, 0) as previous_root_thread_count,
      coalesce(message_metric.previous_distinct_author_count, 0)
        as previous_distinct_author_count,
      coalesce(vote_metric.previous_useful_vote_count, 0)
        as previous_useful_vote_count,
      coalesce(vote_metric.previous_distinct_voter_count, 0)
        as previous_distinct_voter_count,
      message_metric.first_root_at,
      greatest(message_metric.last_message_at, vote_metric.last_vote_at)
        as last_activity_at,
      public.opinion_trend_signal_score(
        coalesce(message_metric.distinct_author_count, 0),
        coalesce(message_metric.root_thread_count, 0),
        coalesce(message_metric.message_count, 0),
        coalesce(vote_metric.distinct_voter_count, 0),
        topic_window.target_authors,
        topic_window.target_root_threads,
        topic_window.target_messages,
        topic_window.target_voters
      ) as window_score,
      public.opinion_trend_signal_score(
        coalesce(message_metric.previous_distinct_author_count, 0),
        coalesce(message_metric.previous_root_thread_count, 0),
        coalesce(message_metric.previous_message_count, 0),
        coalesce(vote_metric.previous_distinct_voter_count, 0),
        topic_window.target_authors,
        topic_window.target_root_threads,
        topic_window.target_messages,
        topic_window.target_voters
      ) as previous_window_score
    from topic_windows as topic_window
    join message_metrics as message_metric
      on message_metric.topic_id = topic_window.topic_id
      and message_metric.window_minutes = topic_window.window_minutes
    join vote_metrics as vote_metric
      on vote_metric.topic_id = topic_window.topic_id
      and vote_metric.window_minutes = topic_window.window_minutes
  )
  insert into public.opinion_topic_trend_windows (
    topic_id,
    window_minutes,
    message_count,
    root_thread_count,
    distinct_author_count,
    useful_vote_count,
    distinct_voter_count,
    previous_message_count,
    previous_root_thread_count,
    previous_distinct_author_count,
    previous_useful_vote_count,
    previous_distinct_voter_count,
    window_score,
    previous_window_score,
    acceleration_ratio,
    first_root_at,
    last_activity_at,
    calculated_at
  )
  select
    measured.topic_id,
    measured.window_minutes,
    measured.message_count,
    measured.root_thread_count,
    measured.distinct_author_count,
    measured.useful_vote_count,
    measured.distinct_voter_count,
    measured.previous_message_count,
    measured.previous_root_thread_count,
    measured.previous_distinct_author_count,
    measured.previous_useful_vote_count,
    measured.previous_distinct_voter_count,
    measured.window_score,
    measured.previous_window_score,
    least(
      10::double precision,
      (measured.window_score + 5) / (measured.previous_window_score + 5)
    ),
    measured.first_root_at,
    measured.last_activity_at,
    p_as_of
  from measured
  on conflict (topic_id, window_minutes) do update set
    message_count = excluded.message_count,
    root_thread_count = excluded.root_thread_count,
    distinct_author_count = excluded.distinct_author_count,
    useful_vote_count = excluded.useful_vote_count,
    distinct_voter_count = excluded.distinct_voter_count,
    previous_message_count = excluded.previous_message_count,
    previous_root_thread_count = excluded.previous_root_thread_count,
    previous_distinct_author_count = excluded.previous_distinct_author_count,
    previous_useful_vote_count = excluded.previous_useful_vote_count,
    previous_distinct_voter_count = excluded.previous_distinct_voter_count,
    window_score = excluded.window_score,
    previous_window_score = excluded.previous_window_score,
    acceleration_ratio = excluded.acceleration_ratio,
    first_root_at = excluded.first_root_at,
    last_activity_at = excluded.last_activity_at,
    calculated_at = excluded.calculated_at;

  for topic_row in
    select
      topic.id as topic_id,
      open_cycle.id as open_cycle_id,
      open_cycle.starts_at as open_cycle_starts_at,
      previous_trend.cycle_id as previous_cycle_id,
      previous_trend.lifecycle_status as previous_status,
      previous_trend.first_detected_at as previous_first_detected_at,
      previous_trend.became_hot_at as previous_became_hot_at,
      previous_trend.declining_at as previous_declining_at,
      previous_trend.archived_at as previous_archived_at,
      previous_trend.status_since as previous_status_since,
      seven_day.message_count as seven_day_message_count,
      seven_day.distinct_voter_count as seven_day_voter_count,
      seven_day.first_root_at as seven_day_first_root_at,
      seven_day.last_activity_at as seven_day_last_activity_at
    from public.opinion_topics as topic
    left join public.opinion_topic_cycles as open_cycle
      on open_cycle.topic_id = topic.id
      and open_cycle.status = 'open'
    left join public.opinion_topic_trends as previous_trend
      on previous_trend.topic_id = topic.id
    join public.opinion_topic_trend_windows as seven_day
      on seven_day.topic_id = topic.id
      and seven_day.window_minutes = 10080
    where topic.status = 'active'
    order by topic.id
  loop
    selected_window := null;
    selected_score := 0;
    selected_acceleration := 1;

    select
      trend_window.window_minutes,
      trend_window.window_score,
      trend_window.acceleration_ratio
    into selected_window, selected_score, selected_acceleration
    from public.opinion_topic_trend_windows as trend_window
    join public.opinion_trend_window_settings as setting
      on setting.window_minutes = trend_window.window_minutes
    where trend_window.topic_id = topic_row.topic_id
      and trend_window.root_thread_count >= setting.hot_min_root_threads
      and trend_window.message_count >= setting.hot_min_messages
      and (
        trend_window.distinct_author_count >= setting.hot_min_authors
        or trend_window.distinct_voter_count >= setting.hot_min_voters
      )
    order by setting.priority
    limit 1;

    is_hot := found;

    if not is_hot then
      select
        trend_window.window_minutes,
        trend_window.window_score,
        trend_window.acceleration_ratio
      into selected_window, selected_score, selected_acceleration
      from public.opinion_topic_trend_windows as trend_window
      join public.opinion_trend_window_settings as setting
        on setting.window_minutes = trend_window.window_minutes
      where trend_window.topic_id = topic_row.topic_id
        and (
          trend_window.message_count > 0
          or trend_window.distinct_voter_count > 0
        )
      order by setting.priority
      limit 1;

      if not found then
        selected_window := null;
        selected_score := 0;
        selected_acceleration := 1;
      end if;
    end if;

    active_cycle_id := topic_row.open_cycle_id;
    active_cycle_starts_at := topic_row.open_cycle_starts_at;
    has_activity := topic_row.seven_day_message_count > 0
      or topic_row.seven_day_voter_count > 0;

    if active_cycle_id is null and topic_row.seven_day_first_root_at is not null then
      active_cycle_id := public.open_opinion_topic_cycle(
        topic_row.topic_id,
        topic_row.seven_day_first_root_at
      );
      active_cycle_starts_at := topic_row.seven_day_first_root_at;
    end if;

    if is_hot then
      next_status := 'hot';
    elsif has_activity and topic_row.previous_status in ('hot', 'declining') then
      next_status := 'declining';
    elsif has_activity then
      next_status := 'emerging';
    elsif active_cycle_id is not null
      and p_as_of < active_cycle_starts_at + interval '7 days' then
      next_status := 'emerging';
    else
      next_status := 'archived';
    end if;

    if next_status = 'archived' and active_cycle_id is not null then
      update public.opinion_topic_cycles
      set
        status = 'archived',
        ends_at = greatest(p_as_of, starts_at + interval '1 microsecond')
      where id = active_cycle_id
        and status = 'open';
    end if;

    cycle_changed := topic_row.previous_cycle_id is distinct from active_cycle_id;

    if cycle_changed then
      next_first_detected_at := case
        when next_status = 'archived' then null
        else p_as_of
      end;
      next_became_hot_at := case when next_status = 'hot' then p_as_of else null end;
      next_declining_at := case when next_status = 'declining' then p_as_of else null end;
      next_archived_at := case when next_status = 'archived' then p_as_of else null end;
      next_status_since := p_as_of;
    else
      next_first_detected_at := coalesce(
        topic_row.previous_first_detected_at,
        case when next_status <> 'archived' then p_as_of else null end
      );
      next_became_hot_at := case
        when next_status = 'hot' and topic_row.previous_status <> 'hot' then p_as_of
        else topic_row.previous_became_hot_at
      end;
      next_declining_at := case
        when next_status = 'declining' and topic_row.previous_status <> 'declining' then p_as_of
        else topic_row.previous_declining_at
      end;
      next_archived_at := case
        when next_status = 'archived' and topic_row.previous_status <> 'archived' then p_as_of
        when next_status <> 'archived' then null
        else topic_row.previous_archived_at
      end;
      next_status_since := case
        when topic_row.previous_status is not distinct from next_status then
          coalesce(topic_row.previous_status_since, p_as_of)
        else p_as_of
      end;
    end if;

    insert into public.opinion_topic_trends (
      topic_id,
      cycle_id,
      lifecycle_status,
      dominant_window_minutes,
      trend_score,
      acceleration_ratio,
      last_activity_at,
      first_detected_at,
      became_hot_at,
      declining_at,
      archived_at,
      status_since,
      calculated_at
    )
    values (
      topic_row.topic_id,
      active_cycle_id,
      next_status,
      selected_window,
      selected_score,
      selected_acceleration,
      topic_row.seven_day_last_activity_at,
      next_first_detected_at,
      next_became_hot_at,
      next_declining_at,
      next_archived_at,
      next_status_since,
      p_as_of
    )
    on conflict (topic_id) do update set
      cycle_id = excluded.cycle_id,
      lifecycle_status = excluded.lifecycle_status,
      dominant_window_minutes = excluded.dominant_window_minutes,
      trend_score = excluded.trend_score,
      acceleration_ratio = excluded.acceleration_ratio,
      last_activity_at = excluded.last_activity_at,
      first_detected_at = excluded.first_detected_at,
      became_hot_at = excluded.became_hot_at,
      declining_at = excluded.declining_at,
      archived_at = excluded.archived_at,
      status_since = excluded.status_since,
      calculated_at = excluded.calculated_at;
  end loop;

  select jsonb_object_agg(state.lifecycle_status, state.topic_count)
  into state_counts
  from (
    select trend.lifecycle_status, count(*)::integer as topic_count
    from public.opinion_topic_trends as trend
    group by trend.lifecycle_status
  ) as state;

  return jsonb_build_object(
    'calculated_at', p_as_of,
    'states', coalesce(state_counts, '{}'::jsonb),
    'window_rows', (
      select count(*)::integer from public.opinion_topic_trend_windows
    )
  );
end;
$$;

revoke all on function public.opinion_trend_signal_score(
  integer,
  integer,
  integer,
  integer,
  double precision,
  double precision,
  double precision,
  double precision
) from public, anon, authenticated;
revoke all on function public.refresh_opinion_trends(timestamptz)
  from public, anon, authenticated;

grant execute on function public.refresh_opinion_trends(timestamptz)
  to service_role, danaus_opinion_worker;

select public.refresh_opinion_trends(now());
