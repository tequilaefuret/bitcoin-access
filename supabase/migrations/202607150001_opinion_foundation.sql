-- Foundation for the Classic/Opinion feeds.
-- Reactions, private stances and editorial perspective buckets are server-only.

create table if not exists public.message_useful_votes (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  bitcoin_address text not null references public.user_balances(bitcoin_address) on delete cascade,
  created_at timestamptz not null default now(),
  constraint message_useful_votes_message_user_unique unique (message_id, bitcoin_address)
);

create index if not exists message_useful_votes_message_id_idx
  on public.message_useful_votes (message_id);

create index if not exists message_useful_votes_user_created_at_idx
  on public.message_useful_votes (bitcoin_address, created_at desc);

alter table public.messages
  add column if not exists useful_count integer not null default 0;

create or replace function public.sync_message_useful_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_message_id uuid;
begin
  target_message_id := case
    when TG_OP = 'DELETE' then OLD.message_id
    else NEW.message_id
  end;

  update public.messages
  set useful_count = (
    select count(*)::integer
    from public.message_useful_votes
    where message_id = target_message_id
  )
  where id = target_message_id;

  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

drop trigger if exists message_useful_votes_sync_count on public.message_useful_votes;
create trigger message_useful_votes_sync_count
after insert or delete on public.message_useful_votes
for each row execute function public.sync_message_useful_count();

revoke all on function public.sync_message_useful_count() from public, anon, authenticated;

create index if not exists messages_useful_feed_idx
  on public.messages (useful_count desc, created_at desc)
  where deleted_at is null and parent_id is null;

create table if not exists public.opinion_topics (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  category text not null,
  title text not null,
  question text not null,
  status text not null default 'active',
  sort_rank integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opinion_topics_slug_check check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint opinion_topics_status_check check (status in ('draft', 'active', 'archived'))
);

create index if not exists opinion_topics_status_sort_rank_idx
  on public.opinion_topics (status, sort_rank, created_at desc);

create table if not exists public.opinion_topic_messages (
  topic_id uuid not null references public.opinion_topics(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  perspective_bucket text not null,
  selection_source text not null default 'manual',
  quality_score numeric not null default 0,
  selected_at timestamptz not null default now(),
  primary key (topic_id, message_id),
  constraint opinion_topic_messages_perspective_check
    check (perspective_bucket in ('side_a', 'side_b', 'bridge', 'question')),
  constraint opinion_topic_messages_source_check
    check (selection_source in ('manual', 'useful', 'algorithm', 'moderator'))
);

create index if not exists opinion_topic_messages_topic_bucket_idx
  on public.opinion_topic_messages (topic_id, perspective_bucket, quality_score desc, selected_at desc);

create index if not exists opinion_topic_messages_message_id_idx
  on public.opinion_topic_messages (message_id);

create table if not exists public.private_topic_stances (
  topic_id uuid not null references public.opinion_topics(id) on delete cascade,
  bitcoin_address text not null references public.user_balances(bitcoin_address) on delete cascade,
  stance text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (topic_id, bitcoin_address),
  constraint private_topic_stances_value_check
    check (stance in ('for', 'against', 'undecided', 'learning'))
);

create index if not exists private_topic_stances_user_updated_at_idx
  on public.private_topic_stances (bitcoin_address, updated_at desc);

-- All access goes through the authenticated user-operations Edge Function.
-- In particular, clients cannot enumerate another reader's private stance.
alter table public.message_useful_votes enable row level security;
alter table public.opinion_topics enable row level security;
alter table public.opinion_topic_messages enable row level security;
alter table public.private_topic_stances enable row level security;

revoke all on table public.message_useful_votes from anon, authenticated;
revoke all on table public.opinion_topics from anon, authenticated;
revoke all on table public.opinion_topic_messages from anon, authenticated;
revoke all on table public.private_topic_stances from anon, authenticated;

-- Pilot subjects. These are questions, not generated or allegedly neutral summaries.
insert into public.opinion_topics (id, slug, category, title, question, status, sort_rank)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'inflation-and-savings',
    'Finance',
    'Inflation and savings',
    'Should protecting purchasing power take priority over supporting demand and employment?',
    'active',
    10
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'remote-work-and-productivity',
    'Society',
    'Remote work and productivity',
    'Does remote work improve productivity and quality of life over the long term?',
    'active',
    20
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'nuclear-power',
    'Environment',
    'Nuclear power',
    'Should nuclear power play a larger role in the transition to low-carbon energy?',
    'active',
    30
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    'ai-regulation',
    'Technology',
    'AI regulation',
    'Should governments regulate powerful AI systems before their harms are fully demonstrated?',
    'active',
    40
  )
on conflict (slug) do update set
  category = excluded.category,
  title = excluded.title,
  question = excluded.question,
  status = excluded.status,
  sort_rank = excluded.sort_rank,
  updated_at = now();
