\set ON_ERROR_STOP on

begin;

-- Minimal production prerequisites. The migration and all assertions run in
-- one transaction, so this script leaves the database unchanged.
create table public.user_balances (
  bitcoin_address text primary key
);

create table public.user_profiles (
  bitcoin_address text primary key references public.user_balances(bitcoin_address),
  display_name text,
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  bitcoin_address text not null references public.user_balances(bitcoin_address),
  content text not null default '',
  created_at timestamptz not null default now(),
  parent_id uuid references public.messages(id),
  repost_of uuid references public.messages(id),
  deleted_at timestamptz
);

create table public.message_useful_votes (
  message_id uuid not null references public.messages(id),
  bitcoin_address text not null references public.user_balances(bitcoin_address),
  created_at timestamptz not null default now(),
  primary key (message_id, bitcoin_address)
);

create table public.follows (
  follower_address text not null references public.user_balances(bitcoin_address),
  following_address text not null references public.user_balances(bitcoin_address),
  created_at timestamptz not null default now(),
  primary key (follower_address, following_address)
);

\ir ../supabase/migrations/202608140001_editorial_safety.sql

insert into public.user_balances (bitcoin_address)
values
  ('reader'), ('author'), ('other'),
  ('actor-1'), ('actor-2'), ('actor-3'),
  ('actor-4'), ('actor-5'), ('actor-6');

insert into public.user_profiles (bitcoin_address, display_name, created_at)
values
  ('reader', 'reader', now() - interval '1 year'),
  ('author', 'author', now() - interval '1 year'),
  ('other', 'other', now() - interval '1 year'),
  ('actor-1', 'actor-1', now()),
  ('actor-2', 'actor-2', now()),
  ('actor-3', 'actor-3', now()),
  ('actor-4', 'actor-4', now()),
  ('actor-5', 'actor-5', now()),
  ('actor-6', 'actor-6', now());

insert into public.messages (id, bitcoin_address, content)
values ('10000000-0000-4000-8000-000000000001', 'author', 'Safety test post');

-- Preferences are exclusive, blocking severs both follow directions, and
-- selecting "none" makes the action reversible.
insert into public.follows (follower_address, following_address)
values ('reader', 'author'), ('author', 'reader');

select * from public.set_editorial_author_preference('reader', 'author', 'reduce');
select * from public.set_editorial_author_preference('reader', 'author', 'block');

do $$
begin
  if not exists (
    select 1 from public.editorial_author_preferences
    where reader_address = 'reader'
      and target_address = 'author'
      and preference = 'block'
  ) then
    raise exception 'Block preference was not saved';
  end if;

  if exists (
    select 1 from public.follows
    where (follower_address = 'reader' and following_address = 'author')
       or (follower_address = 'author' and following_address = 'reader')
  ) then
    raise exception 'Blocking must remove both follow relationships';
  end if;
end;
$$;

select * from public.set_editorial_author_preference('reader', 'author', 'none');

do $$
begin
  if exists (
    select 1 from public.editorial_author_preferences
    where reader_address = 'reader' and target_address = 'author'
  ) then
    raise exception 'Restoring an author must remove the preference';
  end if;
end;
$$;

-- Reports are idempotent: one reporter contributes at most one count for the
-- same target. No textual reason or public reporter list is stored.
select * from public.record_editorial_report(
  'reader', 'message', '10000000-0000-4000-8000-000000000001', null
);
select * from public.record_editorial_report(
  'reader', 'message', '10000000-0000-4000-8000-000000000001', null
);
select * from public.record_editorial_report('reader', 'profile', null, 'author');
select * from public.record_editorial_report('reader', 'profile', null, 'author');

do $$
begin
  if (select report_count from public.messages where id = '10000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'A duplicate post report changed the aggregate count';
  end if;
  if (select report_count from public.user_profiles where bitcoin_address = 'author') <> 1 then
    raise exception 'A duplicate profile report changed the aggregate count';
  end if;
  if (select count(*) from public.editorial_reports) <> 2 then
    raise exception 'Expected exactly one private receipt per report target';
  end if;
  if has_table_privilege('authenticated', 'public.editorial_reports', 'select') then
    raise exception 'Report receipts must not be readable by authenticated clients';
  end if;
end;
$$;

-- Six distinct, very recent accounts acting within the configured 15-minute
-- window produce only a risk score. Content is never deleted automatically.
insert into public.message_useful_votes (message_id, bitcoin_address)
values
  ('10000000-0000-4000-8000-000000000001', 'actor-1'),
  ('10000000-0000-4000-8000-000000000001', 'actor-2'),
  ('10000000-0000-4000-8000-000000000001', 'actor-3'),
  ('10000000-0000-4000-8000-000000000001', 'actor-4'),
  ('10000000-0000-4000-8000-000000000001', 'actor-5'),
  ('10000000-0000-4000-8000-000000000001', 'actor-6');

insert into public.messages (id, bitcoin_address, content, parent_id)
values
  ('20000000-0000-4000-8000-000000000001', 'actor-1', 'reply 1', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'actor-2', 'reply 2', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000003', 'actor-3', 'reply 3', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000004', 'actor-4', 'reply 4', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000005', 'actor-5', 'reply 5', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000006', 'actor-6', 'reply 6', '10000000-0000-4000-8000-000000000001');

do $$
declare
  risk public.editorial_message_risk%rowtype;
begin
  select * into risk from public.editorial_message_risk
  where message_id = '10000000-0000-4000-8000-000000000001';

  if abs(risk.risk_score - 0.90) > 0.000001 then
    raise exception 'Expected capped risk score 0.90, got %', risk.risk_score;
  end if;
  if not risk.reason_codes @> array[
    'engagement_burst',
    'new_account_concentration',
    'coordinated_multi_action'
  ]::text[] then
    raise exception 'Expected all three simple manipulation signals';
  end if;
  if not exists (
    select 1 from public.messages
    where id = '10000000-0000-4000-8000-000000000001' and deleted_at is null
  ) then
    raise exception 'Automated detection must never delete content';
  end if;
end;
$$;

rollback;
