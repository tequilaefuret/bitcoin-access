-- Legacy hosted projects created several social tables before the repository
-- migrations existed. CREATE TABLE IF NOT EXISTS did not retrofit the foreign
-- keys onto those tables, which allowed a balance row to be deleted while its
-- messages and ledger entries remained. Refuse such drift in the future.

do $$
begin
  if exists (
    select 1
    from public.messages as child
    left join public.user_balances as parent
      on parent.bitcoin_address = child.bitcoin_address
    where parent.bitcoin_address is null
  ) then
    raise exception 'INTEGRITY_ORPHAN: messages.bitcoin_address';
  end if;
  if exists (
    select 1
    from public.transactions as child
    left join public.user_balances as parent
      on parent.bitcoin_address = child.bitcoin_address
    where parent.bitcoin_address is null
  ) then
    raise exception 'INTEGRITY_ORPHAN: transactions.bitcoin_address';
  end if;
  if exists (
    select 1
    from public.canvas_pixels as child
    left join public.user_balances as parent
      on parent.bitcoin_address = child.bitcoin_address
    where parent.bitcoin_address is null
  ) then
    raise exception 'INTEGRITY_ORPHAN: canvas_pixels.bitcoin_address';
  end if;
  if exists (
    select 1
    from public.message_likes as child
    left join public.user_balances as parent
      on parent.bitcoin_address = child.bitcoin_address
    where parent.bitcoin_address is null
  ) then
    raise exception 'INTEGRITY_ORPHAN: message_likes.bitcoin_address';
  end if;
  if exists (
    select 1
    from public.message_dislikes as child
    left join public.user_balances as parent
      on parent.bitcoin_address = child.bitcoin_address
    where parent.bitcoin_address is null
  ) then
    raise exception 'INTEGRITY_ORPHAN: message_dislikes.bitcoin_address';
  end if;
  if exists (
    select 1
    from public.follows as child
    left join public.user_balances as follower
      on follower.bitcoin_address = child.follower_address
    left join public.user_balances as followed
      on followed.bitcoin_address = child.following_address
    where follower.bitcoin_address is null
       or followed.bitcoin_address is null
  ) then
    raise exception 'INTEGRITY_ORPHAN: follows address';
  end if;
  if exists (
    select 1
    from public.billing_idempotency_requests as child
    left join public.user_balances as parent
      on parent.bitcoin_address = child.bitcoin_address
    where parent.bitcoin_address is null
  ) then
    raise exception 'INTEGRITY_ORPHAN: billing_idempotency_requests.bitcoin_address';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'messages_bitcoin_address_fkey'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_bitcoin_address_fkey
      foreign key (bitcoin_address)
      references public.user_balances(bitcoin_address)
      on delete restrict not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_bitcoin_address_fkey'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_bitcoin_address_fkey
      foreign key (bitcoin_address)
      references public.user_balances(bitcoin_address)
      on delete restrict not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'canvas_pixels_bitcoin_address_fkey'
      and conrelid = 'public.canvas_pixels'::regclass
  ) then
    alter table public.canvas_pixels
      add constraint canvas_pixels_bitcoin_address_fkey
      foreign key (bitcoin_address)
      references public.user_balances(bitcoin_address)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'message_likes_bitcoin_address_fkey'
      and conrelid = 'public.message_likes'::regclass
  ) then
    alter table public.message_likes
      add constraint message_likes_bitcoin_address_fkey
      foreign key (bitcoin_address)
      references public.user_balances(bitcoin_address)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'message_dislikes_bitcoin_address_fkey'
      and conrelid = 'public.message_dislikes'::regclass
  ) then
    alter table public.message_dislikes
      add constraint message_dislikes_bitcoin_address_fkey
      foreign key (bitcoin_address)
      references public.user_balances(bitcoin_address)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'follows_follower_address_fkey'
      and conrelid = 'public.follows'::regclass
  ) then
    alter table public.follows
      add constraint follows_follower_address_fkey
      foreign key (follower_address)
      references public.user_balances(bitcoin_address)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'follows_following_address_fkey'
      and conrelid = 'public.follows'::regclass
  ) then
    alter table public.follows
      add constraint follows_following_address_fkey
      foreign key (following_address)
      references public.user_balances(bitcoin_address)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'billing_idempotency_requests_bitcoin_address_fkey'
      and conrelid = 'public.billing_idempotency_requests'::regclass
  ) then
    alter table public.billing_idempotency_requests
      add constraint billing_idempotency_requests_bitcoin_address_fkey
      foreign key (bitcoin_address)
      references public.user_balances(bitcoin_address)
      on delete cascade not valid;
  end if;
end $$;

-- PostgreSQL does not automatically index referencing columns. Existing
-- author, ledger, canvas, follow and idempotency indexes already cover their
-- foreign keys. Reaction index names differ between legacy projects, so detect
-- a compatible one-column index by structure before creating another one.
do $$
begin
  if not exists (
    select 1
    from pg_index as index_definition
    join pg_attribute as column_definition
      on column_definition.attrelid = index_definition.indrelid
     and column_definition.attnum = index_definition.indkey[0]
    where index_definition.indrelid = 'public.message_likes'::regclass
      and index_definition.indisvalid
      and index_definition.indisready
      and index_definition.indpred is null
      and index_definition.indexprs is null
      and index_definition.indnkeyatts = 1
      and column_definition.attname = 'bitcoin_address'
  ) then
    create index message_likes_bitcoin_address_idx
      on public.message_likes (bitcoin_address);
  end if;

  if not exists (
    select 1
    from pg_index as index_definition
    join pg_attribute as column_definition
      on column_definition.attrelid = index_definition.indrelid
     and column_definition.attnum = index_definition.indkey[0]
    where index_definition.indrelid = 'public.message_dislikes'::regclass
      and index_definition.indisvalid
      and index_definition.indisready
      and index_definition.indpred is null
      and index_definition.indexprs is null
      and index_definition.indnkeyatts = 1
      and column_definition.attname = 'bitcoin_address'
  ) then
    create index message_dislikes_bitcoin_address_idx
      on public.message_dislikes (bitcoin_address);
  end if;
end $$;

alter table public.messages
  validate constraint messages_bitcoin_address_fkey;
alter table public.transactions
  validate constraint transactions_bitcoin_address_fkey;
alter table public.canvas_pixels
  validate constraint canvas_pixels_bitcoin_address_fkey;
alter table public.message_likes
  validate constraint message_likes_bitcoin_address_fkey;
alter table public.message_dislikes
  validate constraint message_dislikes_bitcoin_address_fkey;
alter table public.follows
  validate constraint follows_follower_address_fkey;
alter table public.follows
  validate constraint follows_following_address_fkey;
alter table public.billing_idempotency_requests
  validate constraint billing_idempotency_requests_bitcoin_address_fkey;
