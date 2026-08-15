-- Private reader preference for seeing fewer posts related to a detected topic.
-- The browser sends only a message id. Topic resolution remains server-side so
-- internal classification identifiers and scores are never exposed.

create table if not exists public.editorial_topic_preferences (
  reader_address text not null
    references public.user_balances(bitcoin_address) on delete cascade,
  topic_id uuid not null
    references public.opinion_topics(id) on delete cascade,
  preference text not null default 'reduce',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (reader_address, topic_id),
  constraint editorial_topic_preferences_kind_check check (preference = 'reduce')
);

create index if not exists editorial_topic_preferences_reader_updated_idx
  on public.editorial_topic_preferences (reader_address, updated_at desc);

alter table public.editorial_topic_preferences enable row level security;
revoke all on table public.editorial_topic_preferences from public, anon, authenticated;
grant select, insert, update, delete on table public.editorial_topic_preferences to service_role;

create or replace function public.set_editorial_topic_preference_from_message(
  p_reader_address text,
  p_message_id uuid,
  p_preference text
)
returns table (preference text, active boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_topic_id uuid;
begin
  if p_reader_address is null or p_message_id is null then
    raise exception 'Contexte éditorial incomplet';
  end if;
  if p_preference not in ('reduce', 'none') then
    raise exception 'Choix éditorial invalide';
  end if;
  if not exists (
    select 1 from public.user_balances where bitcoin_address = p_reader_address
  ) then
    raise exception 'Utilisateur introuvable';
  end if;
  if not exists (
    select 1 from public.messages
    where id = p_message_id and deleted_at is null
  ) then
    raise exception 'Publication introuvable';
  end if;

  with message_candidates as (
    select message.id as message_id, 0 as source_rank
    from public.messages as message
    where message.id = p_message_id

    union all

    select message.parent_id, 1
    from public.messages as message
    where message.id = p_message_id and message.parent_id is not null

    union all

    select message.repost_of, 1
    from public.messages as message
    where message.id = p_message_id and message.repost_of is not null
  ), topic_candidates as (
    select
      score.topic_id,
      candidate.source_rank,
      case when score.is_primary then 0 else 1 end as mapping_rank,
      score.relevance_score as relevance
    from message_candidates as candidate
    join public.opinion_message_topic_scores as score
      on score.message_id = candidate.message_id
     and score.accepted

    union all

    select
      mapping.topic_id,
      candidate.source_rank,
      2 as mapping_rank,
      mapping.quality_score::double precision as relevance
    from message_candidates as candidate
    join public.opinion_topic_messages as mapping
      on mapping.message_id = candidate.message_id
  )
  select candidate.topic_id
  into resolved_topic_id
  from topic_candidates as candidate
  order by candidate.source_rank, candidate.mapping_rank, candidate.relevance desc
  limit 1;

  if resolved_topic_id is null then
    raise exception 'Sujet indisponible pour cette publication';
  end if;

  if p_preference = 'none' then
    delete from public.editorial_topic_preferences
    where reader_address = p_reader_address and topic_id = resolved_topic_id;
    return query select 'none'::text, false;
    return;
  end if;

  insert into public.editorial_topic_preferences (
    reader_address,
    topic_id,
    preference,
    created_at,
    updated_at
  ) values (
    p_reader_address,
    resolved_topic_id,
    'reduce',
    now(),
    now()
  )
  on conflict (reader_address, topic_id) do update set
    preference = excluded.preference,
    updated_at = now();

  return query select 'reduce'::text, true;
end;
$$;

revoke all on function public.set_editorial_topic_preference_from_message(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_editorial_topic_preference_from_message(text, uuid, text)
  to service_role;
