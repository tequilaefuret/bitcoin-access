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

create table public.canvas_pixels (
  x integer not null,
  y integer not null,
  color text not null,
  bitcoin_address text not null references public.user_balances(bitcoin_address),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (x, y)
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
\ir ../supabase/migrations/20260821205412_fix_social_history_and_profile_counts.sql
\ir ../supabase/migrations/20260821212011_add_post_media.sql
\ir ../supabase/migrations/20260823182330_refundable_content_kib_billing.sql
\ir ../supabase/migrations/20260823184402_harmonize_refundable_shell_locks.sql
\ir ../supabase/migrations/20260823211133_allow_comment_media.sql
\ir ../supabase/migrations/20260823213523_allow_quote_repost_media.sql
\ir ../supabase/migrations/20260824203619_enforce_balance_reference_integrity.sql

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
  useful_vote record;
  message_id uuid;
  oversized_batch uuid[];
  publish_request_id uuid := gen_random_uuid();
  read_request_id uuid := gen_random_uuid();
  own_read_request_id uuid := gen_random_uuid();
  first_message_id uuid;
  second_message_id uuid;
  foreign_message_id uuid;
  transaction_count integer;
  media_lock_transaction_count integer;
  media_unlock_transaction_count integer;
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
  select
    count(*) filter (where type = 'profile_avatar_lock'),
    count(*) filter (where type = 'profile_avatar_unlock')
  into media_lock_transaction_count, media_unlock_transaction_count
  from public.transactions
  where bitcoin_address = 'bc1q-local-security-test';
  if media_lock_transaction_count <> 2 or media_unlock_transaction_count <> 2 then
    raise exception 'Profile media replacement history is incomplete: locks %, unlocks %',
      media_lock_transaction_count, media_unlock_transaction_count;
  end if;

  select * into useful_vote from public.toggle_message_useful_with_cost(
    foreign_message_id, 'bc1q-local-security-test'
  );
  if not useful_vote.active or useful_vote.cost <> 1 or useful_vote.new_balance <> 69999993 then
    raise exception 'Useful was not charged atomically: %', row_to_json(useful_vote);
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

insert into public.user_balances (
  bitcoin_address, btc_balance, shells_balance, shells_spent_total
) values
  ('bc1q-refundable-author', 1, 10000, 0),
  ('bc1q-refundable-foreign', 1, 10000, 0);

insert into public.user_profiles (bitcoin_address, display_name) values
  ('bc1q-refundable-author', 'RefundableAuthor'),
  ('bc1q-refundable-foreign', 'RefundableForeign');

do $$
declare
  profile_lock record;
  published record;
  deleted record;
  reposted record;
  original_message_id uuid;
  post_message_id uuid;
  comment_message_id uuid;
  repost_message_id uuid;
  media_lock_count integer;
  useful_vote record;
  read_charge record;
  follow_lock record;
  editorial_preference record;
  author_balance numeric;
  foreign_balance numeric;
  remaining_follow_rows integer;
  remaining_follow_locks integer;
  photo jsonb := jsonb_build_array(jsonb_build_object(
    'url', 'https://media.example/photo.webp',
    'object_key', 'posts/test/photo.webp',
    'width', 1200,
    'height', 900,
    'bytes', 361472,
    'content_type', 'image/webp'
  ));
begin
  -- 361,472 bytes is exactly 353 KiB and therefore costs 353 shells.
  select * into profile_lock from public.set_profile_media_size_lock(
    'bc1q-refundable-author', 'avatar', 361472, 1080000,
    'https://media.example/avatar.webp', 'profiles/test/avatar.webp'
  );
  if profile_lock.locked_kib <> 353 or profile_lock.new_balance <> 9647 then
    raise exception 'Profile KiB lock is incorrect: %', row_to_json(profile_lock);
  end if;

  select * into profile_lock from public.set_profile_media_size_lock(
    'bc1q-refundable-author', 'avatar', 0, 0, null, null
  );
  if profile_lock.locked_kib <> 0 or profile_lock.new_balance <> 10000 then
    raise exception 'Profile KiB refund is incorrect: %', row_to_json(profile_lock);
  end if;

  select * into published from public.publish_message_with_media_cost(
    'bc1q-refundable-author', 'hello', null, photo
  );
  post_message_id := (published.created_message ->> 'id')::uuid;
  if published.cost <> 358 or published.new_balance <> 9642 then
    raise exception 'Text plus photo charge is incorrect: %', row_to_json(published);
  end if;

  select * into deleted from public.delete_message_and_release_locks(
    'bc1q-refundable-author', post_message_id
  );
  if deleted.refunded_text <> 5 or deleted.refunded_media <> 353
    or deleted.new_balance <> 10000 then
    raise exception 'Post deletion refund is incorrect: %', row_to_json(deleted);
  end if;

  select * into published from public.publish_message_with_media_cost(
    'bc1q-refundable-foreign', 'tenletters', null, photo
  );
  original_message_id := (published.created_message ->> 'id')::uuid;

  select * into reposted from public.toggle_or_create_message_repost(
    'bc1q-refundable-author', original_message_id, null
  );
  repost_message_id := (reposted.created_message ->> 'id')::uuid;
  if reposted.new_balance <> 9990 then
    raise exception 'A simple repost rebilled the photo: %', row_to_json(reposted);
  end if;
  select count(*) into media_lock_count
  from public.shell_locks
  where owner_address = 'bc1q-refundable-author'
    and lock_kind = 'message_media'
    and lock_key = repost_message_id::text;
  if media_lock_count <> 0 then
    raise exception 'A repost created a photo lock';
  end if;

  select * into reposted from public.toggle_or_create_message_repost(
    'bc1q-refundable-author', original_message_id, null
  );
  if reposted.active or reposted.new_balance <> 10000 then
    raise exception 'Simple repost removal did not refund text: %', row_to_json(reposted);
  end if;

  select * into reposted from public.toggle_or_create_message_repost(
    'bc1q-refundable-author', original_message_id, 'quote', photo
  );
  repost_message_id := (reposted.created_message ->> 'id')::uuid;
  if reposted.new_balance <> 9632 then
    raise exception 'Quoted repost cost is incorrect: %', row_to_json(reposted);
  end if;
  if jsonb_array_length(reposted.created_message -> 'media') <> 1 then
    raise exception 'Quoted repost did not retain its own photo';
  end if;
  select count(*) into media_lock_count
  from public.shell_locks
  where owner_address = 'bc1q-refundable-author'
    and lock_kind = 'message_media'
    and lock_key = repost_message_id::text
    and amount = 353;
  if media_lock_count <> 1 then
    raise exception 'Quoted repost photo lock is incorrect';
  end if;

  select * into deleted from public.delete_message_and_release_locks(
    'bc1q-refundable-author', repost_message_id
  );
  if deleted.refunded_text <> 15 or deleted.refunded_media <> 353
    or deleted.new_balance <> 10000 then
    raise exception 'Quoted repost deletion did not refund text and media: %', row_to_json(deleted);
  end if;

  select * into useful_vote from public.toggle_message_useful_with_cost(
    original_message_id, 'bc1q-refundable-author'
  );
  if not useful_vote.active or useful_vote.new_balance <> 9999 or useful_vote.cost <> 1 then
    raise exception 'Useful lock is incorrect: %', row_to_json(useful_vote);
  end if;
  select * into useful_vote from public.toggle_message_useful_with_cost(
    original_message_id, 'bc1q-refundable-author'
  );
  if useful_vote.active or useful_vote.new_balance <> 10000 or useful_vote.cost <> -1 then
    raise exception 'Useful unlock is incorrect: %', row_to_json(useful_vote);
  end if;

  select * into published from public.publish_message_with_media_cost(
    'bc1q-refundable-author', 'reply', original_message_id, photo
  );
  comment_message_id := (published.created_message ->> 'id')::uuid;
  if published.cost <> 358 or published.new_balance <> 9642
    or (published.created_message ->> 'parent_id')::uuid <> original_message_id
    or jsonb_array_length(published.created_message -> 'media') <> 1 then
    raise exception 'Comment text plus photo charge is incorrect: %', row_to_json(published);
  end if;
  select * into deleted from public.delete_message_and_release_locks(
    'bc1q-refundable-author', comment_message_id
  );
  if deleted.refunded_text <> 5 or deleted.refunded_media <> 353
    or deleted.new_balance <> 10000 then
    raise exception 'Comment deletion refund is incorrect: %', row_to_json(deleted);
  end if;

  select * into follow_lock from public.set_follow_with_lock(
    'bc1q-refundable-author', 'bc1q-refundable-foreign', true
  );
  select * into follow_lock from public.set_follow_with_lock(
    'bc1q-refundable-foreign', 'bc1q-refundable-author', true
  );
  select * into editorial_preference from public.set_editorial_author_preference(
    'bc1q-refundable-author', 'bc1q-refundable-foreign', 'block'
  );
  select shells_balance into author_balance from public.user_balances
  where bitcoin_address = 'bc1q-refundable-author';
  select shells_balance into foreign_balance from public.user_balances
  where bitcoin_address = 'bc1q-refundable-foreign';
  select count(*) into remaining_follow_rows from public.follows
  where follower_address in ('bc1q-refundable-author', 'bc1q-refundable-foreign')
    and following_address in ('bc1q-refundable-author', 'bc1q-refundable-foreign');
  select count(*) into remaining_follow_locks from public.shell_locks
  where lock_kind = 'follow'
    and owner_address in ('bc1q-refundable-author', 'bc1q-refundable-foreign');
  if not editorial_preference.active or author_balance <> 10000
    or foreign_balance <> 9637 or remaining_follow_rows <> 0
    or remaining_follow_locks <> 0 then
    raise exception 'Blocking did not refund both follow locks';
  end if;
  begin
    perform public.set_follow_with_lock(
      'bc1q-refundable-foreign', 'bc1q-refundable-author', true
    );
    raise exception 'A blocked follow was accepted';
  exception
    when others then
      if sqlerrm = 'A blocked follow was accepted' then raise; end if;
      if sqlerrm <> 'Interaction impossible entre ces comptes' then raise; end if;
  end;

  select * into read_charge from public.charge_message_batch(
    'bc1q-refundable-author', array[original_message_id]
  );
  if read_charge.charged_count <> 1 or read_charge.cost <> 1 or read_charge.new_balance <> 9999 then
    raise exception 'First message exposure charge is incorrect: %', row_to_json(read_charge);
  end if;
  select * into read_charge from public.charge_message_batch(
    'bc1q-refundable-author', array[original_message_id]
  );
  if read_charge.charged_count <> 0 or read_charge.cost <> 0 or read_charge.new_balance <> 9999 then
    raise exception 'Previously loaded message was charged twice: %', row_to_json(read_charge);
  end if;

  begin
    delete from public.user_balances
    where bitcoin_address = 'bc1q-refundable-foreign';
    raise exception 'A balance with authored messages was deleted';
  exception
    when foreign_key_violation then null;
  end;
end;
$$;

select 'fast billing SQL tests passed' as result;
