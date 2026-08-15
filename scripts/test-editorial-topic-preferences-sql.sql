\set ON_ERROR_STOP on

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end;
$$;

create table public.user_balances (
  bitcoin_address text primary key
);

create table public.messages (
  id uuid primary key,
  bitcoin_address text not null references public.user_balances(bitcoin_address),
  parent_id uuid references public.messages(id),
  repost_of uuid references public.messages(id),
  deleted_at timestamptz
);

create table public.opinion_topics (
  id uuid primary key
);

create table public.opinion_message_topic_scores (
  message_id uuid not null references public.messages(id),
  topic_id uuid not null references public.opinion_topics(id),
  relevance_score double precision not null,
  accepted boolean not null,
  is_primary boolean not null default false,
  primary key (message_id, topic_id)
);

create table public.opinion_topic_messages (
  message_id uuid not null references public.messages(id),
  topic_id uuid not null references public.opinion_topics(id),
  quality_score numeric not null default 0,
  primary key (message_id, topic_id)
);

\ir ../supabase/migrations/202608150001_editorial_topic_preferences.sql

insert into public.user_balances (bitcoin_address) values ('reader'), ('author');
insert into public.opinion_topics (id)
values ('30000000-0000-4000-8000-000000000001');
insert into public.messages (id, bitcoin_address, parent_id)
values
  ('10000000-0000-4000-8000-000000000001', 'author', null),
  ('20000000-0000-4000-8000-000000000001', 'author', '10000000-0000-4000-8000-000000000001');
insert into public.opinion_message_topic_scores (
  message_id, topic_id, relevance_score, accepted, is_primary
) values (
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  0.94,
  true,
  true
);

-- A comment inherits the reliable topic of its parent without exposing the id
-- to the browser.
select * from public.set_editorial_topic_preference_from_message(
  'reader',
  '20000000-0000-4000-8000-000000000001',
  'reduce'
);

do $$
begin
  if not exists (
    select 1 from public.editorial_topic_preferences
    where reader_address = 'reader'
      and topic_id = '30000000-0000-4000-8000-000000000001'
      and preference = 'reduce'
  ) then
    raise exception 'The inherited topic preference was not stored';
  end if;
  if has_table_privilege('authenticated', 'public.editorial_topic_preferences', 'select') then
    raise exception 'Topic preferences must remain private';
  end if;
end;
$$;

select * from public.set_editorial_topic_preference_from_message(
  'reader',
  '10000000-0000-4000-8000-000000000001',
  'none'
);

do $$
begin
  if exists (
    select 1 from public.editorial_topic_preferences
    where reader_address = 'reader'
  ) then
    raise exception 'Removing a topic preference must delete it';
  end if;
end;
$$;

rollback;
