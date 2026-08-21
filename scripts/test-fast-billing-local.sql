\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create table public.user_balances (
  bitcoin_address text primary key,
  btc_balance numeric not null default 0,
  shells_balance numeric not null default 0,
  shells_spent_total numeric not null default 0,
  last_sync timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  bitcoin_address text not null references public.user_balances(bitcoin_address),
  content text not null,
  char_count integer not null default 0,
  cost_shells numeric not null default 0,
  parent_id uuid references public.messages(id),
  repost_of uuid references public.messages(id),
  repost_kind text,
  useful_count integer not null default 0,
  content_origin text,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  bitcoin_address text not null references public.user_balances(bitcoin_address),
  amount numeric not null,
  type text not null,
  game_score integer,
  created_at timestamptz not null default now()
);

create table public.user_profiles (
  bitcoin_address text primary key references public.user_balances(bitcoin_address),
  display_name text not null,
  avatar_url text,
  cover_url text,
  updated_at timestamptz not null default now()
);

create table public.message_useful_votes (
  message_id uuid not null references public.messages(id),
  bitcoin_address text not null references public.user_balances(bitcoin_address),
  primary key (message_id, bitcoin_address)
);

create table public.message_likes (
  message_id uuid not null references public.messages(id),
  bitcoin_address text not null references public.user_balances(bitcoin_address),
  primary key (message_id, bitcoin_address)
);

create table public.message_dislikes (
  message_id uuid not null references public.messages(id),
  bitcoin_address text not null references public.user_balances(bitcoin_address),
  primary key (message_id, bitcoin_address)
);

create table public.follows (
  follower_address text not null references public.user_balances(bitcoin_address),
  following_address text not null references public.user_balances(bitcoin_address),
  created_at timestamptz not null default now(),
  primary key (follower_address, following_address)
);

create table public.editorial_author_preferences (
  reader_address text not null references public.user_balances(bitcoin_address),
  target_address text not null references public.user_balances(bitcoin_address),
  preference text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (reader_address, target_address)
);

\ir ../supabase/migrations/202608080002_fast_atomic_charges.sql
\ir ../supabase/migrations/202608080003_transactional_billing_idempotency.sql
\ir ../supabase/migrations/20260820222705_shell_units_and_refundable_locks.sql

insert into public.user_balances (
  bitcoin_address, btc_balance, shells_balance, shells_spent_total
) values
  ('bc1q-local-security-test', 1, 100000000, 0),
  ('bc1q-foreign-author', 1, 100000000, 0);

insert into public.user_profiles (bitcoin_address, display_name) values
  ('bc1q-local-security-test', 'LocalTester'),
  ('bc1q-foreign-author', 'ForeignAuthor');

do $$
declare
  published record;
  charged record;
  own_read record;
  reconciled record;
  followed record;
  media_lock record;
  message_id uuid;
  oversized_batch uuid[];
  publish_request_id uuid := gen_random_uuid();
  read_request_id uuid := gen_random_uuid();
  own_read_request_id uuid := gen_random_uuid();
  first_message_id uuid;
  second_message_id uuid;
  foreign_message_id uuid;
  transaction_count integer;
begin
  select * into published
  from public.publish_message_with_cost_idempotent(
    publish_request_id,
    'bc1q-local-security-test',
    'hello',
    null
  );

  if published.cost <> 5 or published.new_balance <> 99999995 then
    raise exception 'Unexpected publication charge: %', row_to_json(published);
  end if;

  message_id := (published.created_message ->> 'id')::uuid;

  select * into published
  from public.publish_message_with_cost_idempotent(
    publish_request_id,
    'bc1q-local-security-test',
    'hello',
    null
  );
  first_message_id := (published.created_message ->> 'id')::uuid;
  if not published.replayed or first_message_id <> message_id then
    raise exception 'Publication retry was not idempotent: %', row_to_json(published);
  end if;

  insert into public.messages (bitcoin_address, content, char_count, cost_shells)
  values ('bc1q-foreign-author', 'foreign', 7, 0)
  returning id into foreign_message_id;

  select * into charged
  from public.charge_message_batch_idempotent(
    read_request_id,
    'bc1q-local-security-test',
    array[foreign_message_id],
    '{"limit": 20, "offset": 0, "parent_id": null, "sort_mode": "recent"}'::jsonb,
    jsonb_build_array(jsonb_build_object('id', foreign_message_id, 'content', 'foreign'))
  );

  if charged.charged_count <> 1
    or charged.cost <> 1
    or charged.new_balance <> 99999994 then
    raise exception 'Unexpected batch charge: %', row_to_json(charged);
  end if;

  insert into public.messages (bitcoin_address, content, char_count, cost_shells)
  values ('bc1q-local-security-test', 'newer', 5, 0)
  returning id into second_message_id;

  select * into charged
  from public.charge_message_batch_idempotent(
    read_request_id,
    'bc1q-local-security-test',
    array[second_message_id],
    '{"limit": 20, "offset": 0, "parent_id": null, "sort_mode": "recent"}'::jsonb,
    jsonb_build_array(jsonb_build_object('id', second_message_id, 'content', 'newer'))
  );
  if not charged.replayed or charged.new_balance <> 99999994
    or (charged.messages_snapshot -> 0 ->> 'id')::uuid <> foreign_message_id then
    raise exception 'Read retry was not idempotent: %', row_to_json(charged);
  end if;

  select * into own_read
  from public.charge_message_batch_idempotent(
    own_read_request_id,
    'bc1q-local-security-test',
    array[message_id],
    '{"view": "own-content"}'::jsonb,
    jsonb_build_array(jsonb_build_object('id', message_id, 'content', 'hello'))
  );
  if own_read.charged_count <> 0 or own_read.cost <> 0 or own_read.new_balance <> 99999994 then
    raise exception 'The author was charged for their own publication: %', row_to_json(own_read);
  end if;

  select count(*) into transaction_count from public.transactions;
  if transaction_count <> 2 then
    raise exception 'Retries created extra transactions: %', transaction_count;
  end if;

  select * into reconciled
  from public.reconcile_bitcoin_balance('bc1q-local-security-test', 0.8);

  if reconciled.balance_delta <> -20000000
    or reconciled.btc_balance <> 0.8
    or reconciled.shells_balance <> 79999994 then
    raise exception 'Unexpected reconciliation: %', row_to_json(reconciled);
  end if;

  -- An older observation finishing later must not restore a stale balance.
  select * into reconciled
  from public.reconcile_bitcoin_balance_v2(
    'bc1q-local-security-test',
    0.7,
    '2026-08-08T12:00:02Z'
  );
  if not reconciled.applied or reconciled.btc_balance <> 0.7 then
    raise exception 'New balance observation was not applied: %', row_to_json(reconciled);
  end if;

  select * into reconciled
  from public.reconcile_bitcoin_balance_v2(
    'bc1q-local-security-test',
    0.9,
    '2026-08-08T12:00:01Z'
  );
  if reconciled.applied or reconciled.btc_balance <> 0.7
    or reconciled.balance_delta <> 0 then
    raise exception 'Stale balance observation was applied: %', row_to_json(reconciled);
  end if;

  select * into followed from public.set_follow_with_lock(
    'bc1q-local-security-test', 'bc1q-foreign-author', true
  );
  if not followed.active or followed.lock_delta <> 10 or followed.new_balance <> 69999984 then
    raise exception 'Follow lock was not applied: %', row_to_json(followed);
  end if;
  select * into followed from public.set_follow_with_lock(
    'bc1q-local-security-test', 'bc1q-foreign-author', false
  );
  if followed.active or followed.lock_delta <> -10 or followed.new_balance <> 69999994 then
    raise exception 'Follow lock was not refunded: %', row_to_json(followed);
  end if;

  select * into media_lock from public.set_profile_media_lock(
    'bc1q-local-security-test', 'avatar', 20000, 'https://media.example/avatar-a', 'profiles/test/avatar-a'
  );
  if media_lock.lock_delta <> 20000 or media_lock.new_balance <> 69979994 then
    raise exception 'Profile media lock was not applied: %', row_to_json(media_lock);
  end if;
  select * into media_lock from public.set_profile_media_lock(
    'bc1q-local-security-test', 'avatar', 10000, 'https://media.example/avatar-b', 'profiles/test/avatar-b'
  );
  if media_lock.lock_delta <> -10000 or media_lock.new_balance <> 69989994 then
    raise exception 'Smaller profile media did not refund the difference: %', row_to_json(media_lock);
  end if;
  select * into media_lock from public.set_profile_media_lock(
    'bc1q-local-security-test', 'avatar', 0, null, null
  );
  if media_lock.lock_delta <> -10000 or media_lock.new_balance <> 69999994 then
    raise exception 'Profile media removal did not refund its lock: %', row_to_json(media_lock);
  end if;

  begin
    select array_agg(gen_random_uuid()) into oversized_batch
    from generate_series(1, 201);
    perform public.charge_message_batch_idempotent(
      gen_random_uuid(),
      'bc1q-local-security-test',
      oversized_batch,
      '{"limit": 20, "offset": 0, "parent_id": null, "sort_mode": "recent"}'::jsonb,
      '[]'::jsonb
    );
    raise exception 'The 200-item batch limit was not enforced';
  exception
    when others then
      if sqlerrm = 'The 200-item batch limit was not enforced' then raise; end if;
  end;
end;
$$;

select 'fast billing SQL tests passed' as result;
