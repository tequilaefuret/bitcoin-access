select content_origin, count(*)::integer as message_count
from public.messages
group by content_origin
order by content_origin;

select
  count(*) filter (where embedding.status = 'ready')::integer as ready_topics,
  count(*) filter (where embedding.status <> 'ready')::integer as non_ready_topics
from public.opinion_topic_embeddings as embedding;

select count(*)::integer as test_message_embeddings
from public.message_embeddings as embedding
join public.messages as message on message.id = embedding.message_id
where message.content_origin = 'test';

select count(*)::integer as automatic_topic_scores
from public.opinion_message_topic_scores;

select
  topic.slug,
  settings.min_similarity,
  cycle.sequence_number,
  cycle.status,
  cycle.starts_at
from public.opinion_topics as topic
join public.opinion_topic_classifier_settings as settings
  on settings.topic_id = topic.id
join public.opinion_topic_cycles as cycle
  on cycle.topic_id = topic.id
where topic.status = 'active'
order by topic.sort_rank;

select
  public.opinion_wilson_lower_bound(0, 0) as no_signal,
  public.opinion_wilson_lower_bound(1, 1) as one_of_one,
  public.opinion_wilson_lower_bound(50, 100) as fifty_of_hundred;

select count(*)::integer as queued_embedding_jobs
from pgmq.q_opinion_embeddings;

select
  setting.window_minutes,
  setting.hot_min_authors,
  setting.hot_min_root_threads,
  setting.hot_min_messages,
  setting.hot_min_voters
from public.opinion_trend_window_settings as setting
order by setting.priority;

select
  topic.slug,
  trend.lifecycle_status,
  trend.dominant_window_minutes,
  round(trend.trend_score::numeric, 2) as trend_score,
  round(trend.acceleration_ratio::numeric, 2) as acceleration_ratio,
  trend.last_activity_at,
  trend.calculated_at
from public.opinion_topic_trends as trend
join public.opinion_topics as topic on topic.id = trend.topic_id
order by
  case trend.lifecycle_status
    when 'hot' then 1
    when 'emerging' then 2
    when 'declining' then 3
    else 4
  end,
  trend.dominant_window_minutes nulls last,
  trend.trend_score desc;

select
  settings.lookback_interval,
  settings.inactivity_ttl,
  settings.min_content_chars,
  settings.attach_similarity,
  settings.representative_similarity,
  settings.qualify_min_roots,
  settings.qualify_min_authors,
  settings.qualify_min_average_similarity,
  settings.qualify_min_member_similarity
from public.opinion_topic_discovery_settings as settings
where settings.singleton = true;

select
  candidate.status,
  count(*)::integer as candidate_count,
  coalesce(sum(candidate.root_count), 0)::integer as root_count
from public.opinion_topic_candidates as candidate
group by candidate.status
order by candidate.status;

select
  run.as_of,
  run.eligible_root_count,
  run.assigned_root_count,
  run.created_candidate_count,
  run.collecting_candidate_count,
  run.qualified_candidate_count,
  run.expired_candidate_count,
  run.completed_at - run.started_at as duration
from public.opinion_topic_discovery_runs as run
order by run.id desc
limit 5;
