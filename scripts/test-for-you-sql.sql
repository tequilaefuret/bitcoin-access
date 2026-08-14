\set ON_ERROR_STOP on

begin;

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

-- Minimal representation of the production prerequisites. The migration is
-- tested in a transaction and leaves the database unchanged after rollback.
create table public.user_balances (
  bitcoin_address text primary key
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  bitcoin_address text not null references public.user_balances(bitcoin_address),
  content text not null default '',
  created_at timestamptz not null default now(),
  parent_id uuid,
  repost_of uuid,
  repost_kind text,
  deleted_at timestamptz,
  useful_count integer not null default 0
);

create table public.message_useful_votes (
  message_id uuid not null references public.messages(id),
  bitcoin_address text not null references public.user_balances(bitcoin_address),
  created_at timestamptz not null default now()
);

create table public.message_likes (
  message_id uuid not null references public.messages(id),
  bitcoin_address text not null references public.user_balances(bitcoin_address),
  created_at timestamptz not null default now()
);

create table public.message_dislikes (
  message_id uuid not null references public.messages(id),
  bitcoin_address text not null references public.user_balances(bitcoin_address),
  created_at timestamptz not null default now()
);

create table public.follows (
  follower_address text not null references public.user_balances(bitcoin_address),
  following_address text not null references public.user_balances(bitcoin_address),
  created_at timestamptz not null default now()
);

create table public.message_embeddings (
  message_id uuid primary key references public.messages(id),
  embedding extensions.vector(384),
  status text not null default 'ready'
);

\ir ../supabase/migrations/202608130001_for_you_feed.sql
\ir ../supabase/migrations/202608140002_for_you_exponential_decay.sql

do $$
declare
  at_start double precision;
  at_five_days double precision;
  at_ten_days double precision;
  at_one_month double precision;
  at_one_year double precision;
begin
  select public.for_you_temporal_decay(now()) into at_start;
  select public.for_you_temporal_decay(now() - interval '5 days') into at_five_days;
  select public.for_you_temporal_decay(now() - interval '10 days') into at_ten_days;
  select public.for_you_temporal_decay(now() - interval '30 days') into at_one_month;
  select public.for_you_temporal_decay(now() - interval '365 days') into at_one_year;

  if abs(at_start - 1.0) > 0.00001 then
    raise exception 'A new interaction must have weight 1.0, got %', at_start;
  end if;
  if abs(at_five_days - 0.1) > 0.00001 then
    raise exception 'A five-day interaction must have weight 0.1, got %', at_five_days;
  end if;
  if abs(at_ten_days - 0.01) > 0.00001 then
    raise exception 'A ten-day interaction must reach the 0.01 floor, got %', at_ten_days;
  end if;
  if abs(at_one_month - at_one_year) > 0.0000001 then
    raise exception 'One-month and one-year interactions must have the same residual weight';
  end if;
end;
$$;

do $$
declare
  no_engagement double precision;
  isolated_useful double precision;
  supported_rate double precision;
  high_rate double precision;
  same_engagement_low_reach double precision;
begin
  select public.for_you_normalized_engagement(0, 100, 20) into no_engagement;
  select public.for_you_normalized_engagement(1.7, 0, 20) into isolated_useful;
  select public.for_you_normalized_engagement(17, 100, 20) into supported_rate;
  select public.for_you_normalized_engagement(170, 100, 20) into high_rate;
  select public.for_you_normalized_engagement(17, 10, 20) into same_engagement_low_reach;

  if no_engagement <> 0 then
    raise exception 'A post without engagement must have a zero engagement score';
  end if;
  if isolated_useful >= supported_rate then
    raise exception 'One isolated Useful must not outweigh a supported engagement rate';
  end if;
  if supported_rate >= high_rate or high_rate >= 1 then
    raise exception 'Normalized engagement must grow monotonically and stay below one';
  end if;
  if same_engagement_low_reach <= supported_rate then
    raise exception 'Equal engagement with fewer exposures must keep a higher normalized rate';
  end if;
end;
$$;

insert into public.user_balances (bitcoin_address)
values ('reader'), ('followed-author'), ('discovery-author'), ('other-author'), ('engager');

insert into public.follows (follower_address, following_address)
values ('reader', 'followed-author'), ('reader', 'reader');

insert into public.messages (
  id, bitcoin_address, content, created_at, useful_count
) values
  ('10000000-0000-4000-8000-000000000001', 'discovery-author', 'Reader history', now() - interval '2 days', 1),
  ('10000000-0000-4000-8000-000000000002', 'followed-author', 'Fresh followed post', now() - interval '1 hour', 0),
  ('10000000-0000-4000-8000-000000000003', 'discovery-author', 'Semantically relevant discovery', now() - interval '2 hours', 2),
  ('10000000-0000-4000-8000-000000000004', 'other-author', 'Unrelated post', now() - interval '30 minutes', 0),
  ('10000000-0000-4000-8000-000000000005', 'reader', 'Own post', now() - interval '10 minutes', 50),
  ('10000000-0000-4000-8000-000000000006', 'other-author', 'Disliked post', now() - interval '20 minutes', 20);

insert into public.message_useful_votes (message_id, bitcoin_address)
values ('10000000-0000-4000-8000-000000000001', 'reader');

insert into public.message_dislikes (message_id, bitcoin_address)
values ('10000000-0000-4000-8000-000000000006', 'reader');

insert into public.message_embeddings (message_id, embedding)
values
  (
    '10000000-0000-4000-8000-000000000001',
    array_prepend(1::real, array_fill(0::real, array[383]))::extensions.vector
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    array_prepend(0.8::real, array_prepend(0.2::real, array_fill(0::real, array[382])))::extensions.vector
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    array_prepend(1::real, array_fill(0::real, array[383]))::extensions.vector
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    array_prepend(0::real, array_prepend(1::real, array_fill(0::real, array[382])))::extensions.vector
  );

do $$
declare
  ranked_count integer;
  own_count integer;
  duplicate_count integer;
begin
  select count(*) into ranked_count
  from public.rank_for_you_feed('reader', 20);

  if ranked_count <> 3 then
    raise exception 'Expected 3 eligible recommendations, got %', ranked_count;
  end if;

  select count(*) into own_count
  from public.rank_for_you_feed('reader', 20) as ranked
  where ranked.message_id = '10000000-0000-4000-8000-000000000005';

  if own_count <> 0 then
    raise exception 'The reader own post must not be recommended';
  end if;

  select count(*) - count(distinct message_id) into duplicate_count
  from public.rank_for_you_feed('reader', 20);

  if duplicate_count <> 0 then
    raise exception 'The recommendation list contains duplicates';
  end if;
end;
$$;

select public.record_for_you_impressions(
  'reader',
  '20000000-0000-4000-8000-000000000001',
  array[
    '10000000-0000-4000-8000-000000000002'::uuid,
    '10000000-0000-4000-8000-000000000003'::uuid
  ]
);

do $$
begin
  if public.record_for_you_impressions(
    'reader',
    '20000000-0000-4000-8000-000000000001',
    array['10000000-0000-4000-8000-000000000002'::uuid]
  ) <> 0 then
    raise exception 'Impression retries must be idempotent';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.rank_for_you_feed('reader', 20) as ranked
    where ranked.message_id in (
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003'
    )
  ) then
    raise exception 'Recently served recommendations must not resurface';
  end if;
end;
$$;

select public.record_for_you_feedback(
  'reader',
  '10000000-0000-4000-8000-000000000004',
  'not_interested'
);

do $$
begin
  if exists (
    select 1
    from public.rank_for_you_feed('reader', 20) as ranked
    where ranked.message_id = '10000000-0000-4000-8000-000000000004'
  ) then
    raise exception 'Not-interested content must be removed from recommendations';
  end if;
end;
$$;

-- With every other ranking family disabled, one fresh Useful must carry more
-- weight than an otherwise identical month-old Useful.
insert into public.messages (
  id, bitcoin_address, content, created_at, useful_count
) values
  ('10000000-0000-4000-8000-000000000007', 'discovery-author', 'Fresh engagement', now() - interval '1 hour', 1),
  ('10000000-0000-4000-8000-000000000008', 'other-author', 'Old engagement', now() - interval '1 hour', 1);

insert into public.message_useful_votes (message_id, bitcoin_address, created_at)
values
  ('10000000-0000-4000-8000-000000000007', 'engager', now()),
  ('10000000-0000-4000-8000-000000000008', 'engager', now() - interval '30 days');

update public.for_you_algorithm_settings
set
  semantic_weight = 0,
  author_affinity_weight = 0,
  engagement_weight = 1,
  freshness_weight = 0,
  in_network_weight = 0,
  exploration_weight = 0;

do $$
declare
  fresh_score double precision;
  old_score double precision;
begin
  select rank_score into fresh_score
  from public.rank_for_you_feed('reader', 20)
  where message_id = '10000000-0000-4000-8000-000000000007';

  select rank_score into old_score
  from public.rank_for_you_feed('reader', 20)
  where message_id = '10000000-0000-4000-8000-000000000008';

  if fresh_score is null or old_score is null then
    raise exception 'Both decay comparison candidates must be ranked';
  end if;
  if fresh_score <= old_score * 10 then
    raise exception 'Fresh engagement must substantially outweigh old engagement: % vs %', fresh_score, old_score;
  end if;
end;
$$;

rollback;
