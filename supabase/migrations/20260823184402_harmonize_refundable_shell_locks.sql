-- Centralize every reversible shell debit behind one private primitive. Domain
-- functions still own their business rows, while this helper atomically owns
-- the balance, refundable lock, backing cap and audit entries.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter table public.shell_locks
  drop constraint if exists shell_locks_kind_check;
alter table public.shell_locks
  add constraint shell_locks_kind_check check (
    lock_kind ~ '^[a-z][a-z0-9_]{1,63}$'
  );

alter table public.transactions
  add column if not exists shell_lock_kind text,
  add column if not exists shell_lock_key text;

create or replace function private.set_refundable_shell_lock(
  p_owner_address text,
  p_lock_kind text,
  p_lock_key text,
  p_amount numeric
)
returns table (
  new_balance numeric,
  previous_lock numeric,
  current_lock numeric,
  lock_delta numeric,
  refunded_amount numeric,
  shells_spent_total numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.user_balances%rowtype;
  stored_amount numeric := 0;
  refundable_amount numeric := 0;
  normalized_amount numeric;
  backing_room numeric := 0;
  delta numeric := 0;
begin
  if p_owner_address is null or btrim(p_owner_address) = '' then
    raise exception 'Propriétaire de verrou manquant';
  end if;
  if p_lock_kind is null or p_lock_kind !~ '^[a-z][a-z0-9_]{1,63}$' then
    raise exception 'Type de verrou invalide';
  end if;
  if p_lock_key is null or btrim(p_lock_key) = '' or char_length(p_lock_key) > 500 then
    raise exception 'Clé de verrou invalide';
  end if;
  if p_amount is null or p_amount < 0 or p_amount <> trunc(p_amount) then
    raise exception 'Montant de verrou invalide';
  end if;
  normalized_amount := trunc(p_amount);

  select * into account
  from public.user_balances as balance
  where balance.bitcoin_address = p_owner_address
  for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;

  select lock.amount into stored_amount
  from public.shell_locks as lock
  where lock.owner_address = p_owner_address
    and lock.lock_kind = p_lock_kind
    and lock.lock_key = p_lock_key
  for update;
  stored_amount := coalesce(stored_amount, 0);

  backing_room := greatest(
    0,
    round(coalesce(account.btc_balance, 0) * 100000000) - account.shells_balance
  );
  refundable_amount := least(stored_amount, backing_room);
  delta := normalized_amount - refundable_amount;
  if delta > account.shells_balance then raise exception 'INSUFFICIENT_SHELLS'; end if;

  update public.user_balances as balance
  set shells_balance = account.shells_balance - delta, last_sync = now()
  where balance.bitcoin_address = p_owner_address;

  if normalized_amount = 0 then
    delete from public.shell_locks as lock
    where lock.owner_address = p_owner_address
      and lock.lock_kind = p_lock_kind
      and lock.lock_key = p_lock_key;
  else
    insert into public.shell_locks (owner_address, lock_kind, lock_key, amount)
    values (p_owner_address, p_lock_kind, p_lock_key, normalized_amount)
    on conflict (owner_address, lock_kind, lock_key) do update
      set amount = excluded.amount, updated_at = now();
  end if;

  if refundable_amount > 0 then
    insert into public.transactions (
      bitcoin_address, amount, type, shell_lock_kind, shell_lock_key, created_at
    ) values (
      p_owner_address, refundable_amount, 'shell_unlock', p_lock_kind, p_lock_key,
      clock_timestamp()
    );
  end if;
  if normalized_amount > 0 then
    insert into public.transactions (
      bitcoin_address, amount, type, shell_lock_kind, shell_lock_key, created_at
    ) values (
      p_owner_address, -normalized_amount, 'shell_lock', p_lock_kind, p_lock_key,
      clock_timestamp()
    );
  end if;

  return query select
    account.shells_balance - delta,
    stored_amount,
    normalized_amount,
    delta,
    refundable_amount,
    coalesce(account.shells_spent_total, 0);
end;
$$;

revoke all on function private.set_refundable_shell_lock(text, text, text, numeric)
  from public, anon, authenticated, service_role;

-- Reading is irreversible, but the same message must only ever be charged once
-- per reader, independently of pagination, screen or request id.
create table if not exists public.message_read_receipts (
  reader_address text not null
    references public.user_balances(bitcoin_address) on delete cascade,
  message_id uuid not null
    references public.messages(id) on delete cascade,
  charged_at timestamptz not null default now(),
  primary key (reader_address, message_id)
);

create index if not exists message_read_receipts_message_idx
  on public.message_read_receipts (message_id);

alter table public.message_read_receipts enable row level security;
revoke all on table public.message_read_receipts from public, anon, authenticated;

-- Preserve knowledge from earlier idempotent read requests so already loaded
-- content is not charged again immediately after this migration.
insert into public.message_read_receipts (reader_address, message_id, charged_at)
select distinct
  request.bitcoin_address,
  parsed.message_id,
  request.created_at
from public.billing_idempotency_requests as request
cross join lateral jsonb_array_elements_text(
  case
    when jsonb_typeof(request.response_payload -> 'message_ids') = 'array'
      then request.response_payload -> 'message_ids'
    else '[]'::jsonb
  end
) as exposed(message_id)
cross join lateral (
  select case
    when exposed.message_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then exposed.message_id::uuid
    else null
  end as message_id
) as parsed
join public.messages as message on message.id = parsed.message_id
where request.operation = 'read_messages'
  and parsed.message_id is not null
  and message.bitcoin_address <> request.bitcoin_address
on conflict (reader_address, message_id) do nothing;

create or replace function public.charge_message_batch(
  p_bitcoin_address text,
  p_message_ids uuid[]
)
returns table (
  charged_count integer,
  new_balance numeric,
  shells_spent_total numeric,
  cost numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.user_balances%rowtype;
  unseen_ids uuid[] := array[]::uuid[];
  item_count integer := 0;
  batch_cost numeric := 0;
begin
  if coalesce(array_length(p_message_ids, 1), 0) > 200 then
    raise exception 'Un lot de lecture ne peut pas dépasser 200 publications';
  end if;

  select * into account
  from public.user_balances as balance
  where balance.bitcoin_address = p_bitcoin_address
  for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;

  select coalesce(array_agg(candidate.id order by candidate.id), array[]::uuid[])
  into unseen_ids
  from (
    select distinct message.id
    from unnest(coalesce(p_message_ids, array[]::uuid[])) as requested(message_id)
    join public.messages as message on message.id = requested.message_id
    left join public.message_read_receipts as receipt
      on receipt.reader_address = p_bitcoin_address
      and receipt.message_id = message.id
    where message.deleted_at is null
      and message.bitcoin_address <> p_bitcoin_address
      and receipt.message_id is null
  ) as candidate;

  item_count := coalesce(array_length(unseen_ids, 1), 0);
  batch_cost := item_count;
  if account.shells_balance < batch_cost then raise exception 'INSUFFICIENT_SHELLS'; end if;

  if item_count > 0 then
    insert into public.message_read_receipts (reader_address, message_id)
    select p_bitcoin_address, message_id from unnest(unseen_ids) as message_id
    on conflict (reader_address, message_id) do nothing;

    update public.user_balances as balance
    set
      shells_balance = account.shells_balance - batch_cost,
      shells_spent_total = coalesce(account.shells_spent_total, 0) + batch_cost,
      last_sync = now()
    where balance.bitcoin_address = p_bitcoin_address;
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_bitcoin_address, -batch_cost, 'read_messages', now());
  end if;

  return query select
    item_count,
    account.shells_balance - batch_cost,
    coalesce(account.shells_spent_total, 0) + batch_cost,
    batch_cost;
end;
$$;

revoke all on function public.charge_message_batch(text, uuid[])
  from public, anon, authenticated;
grant execute on function public.charge_message_batch(text, uuid[]) to service_role;

-- Useful votes and legacy like/dislike rows were historically spent forever.
-- Reclassify active actions as refundable reserves without debiting them twice.
with inserted_locks as (
  insert into public.shell_locks (owner_address, lock_kind, lock_key, amount)
  select vote.bitcoin_address, 'useful', vote.message_id::text, 1
  from public.message_useful_votes as vote
  on conflict (owner_address, lock_kind, lock_key) do nothing
  returning owner_address, amount
), totals as (
  select owner_address, sum(amount) as amount
  from inserted_locks group by owner_address
)
update public.user_balances as balance
set shells_spent_total = greatest(0, coalesce(balance.shells_spent_total, 0) - totals.amount)
from totals
where balance.bitcoin_address = totals.owner_address;

with active_reactions as (
  select liked.bitcoin_address, liked.message_id from public.message_likes as liked
  union
  select disliked.bitcoin_address, disliked.message_id from public.message_dislikes as disliked
), inserted_locks as (
  insert into public.shell_locks (owner_address, lock_kind, lock_key, amount)
  select reaction.bitcoin_address, 'reaction', reaction.message_id::text, 1
  from active_reactions as reaction
  on conflict (owner_address, lock_kind, lock_key) do nothing
  returning owner_address, amount
), totals as (
  select owner_address, sum(amount) as amount
  from inserted_locks group by owner_address
)
update public.user_balances as balance
set shells_spent_total = greatest(0, coalesce(balance.shells_spent_total, 0) - totals.amount)
from totals
where balance.bitcoin_address = totals.owner_address;

create or replace function public.toggle_message_useful_with_cost(
  p_message_id uuid,
  p_bitcoin_address text
)
returns table (
  active boolean,
  useful_count integer,
  new_balance numeric,
  shells_spent_total numeric,
  cost numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_author text;
  account public.user_balances%rowtype;
  lock_result record;
  vote_exists boolean := false;
begin
  select * into account
  from public.user_balances as balance
  where balance.bitcoin_address = p_bitcoin_address
  for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;

  select exists (
    select 1 from public.message_useful_votes as vote
    where vote.message_id = p_message_id
      and vote.bitcoin_address = p_bitcoin_address
  ) into vote_exists;

  if vote_exists then
    delete from public.message_useful_votes as vote
    where vote.message_id = p_message_id
      and vote.bitcoin_address = p_bitcoin_address;
    select * into lock_result from private.set_refundable_shell_lock(
      p_bitcoin_address, 'useful', p_message_id::text, 0
    );
    return query select
      false,
      coalesce(message.useful_count, 0),
      lock_result.new_balance,
      lock_result.shells_spent_total,
      lock_result.lock_delta
    from public.messages as message where message.id = p_message_id;
    return;
  end if;

  select message.bitcoin_address into message_author
  from public.messages as message
  where message.id = p_message_id and message.deleted_at is null;
  if not found then raise exception 'Message introuvable'; end if;
  if message_author = p_bitcoin_address then
    raise exception 'Vous ne pouvez pas marquer votre propre publication comme utile';
  end if;

  select * into lock_result from private.set_refundable_shell_lock(
    p_bitcoin_address, 'useful', p_message_id::text, 1
  );
  insert into public.message_useful_votes (message_id, bitcoin_address)
  values (p_message_id, p_bitcoin_address);

  return query select
    true,
    coalesce(message.useful_count, 0),
    lock_result.new_balance,
    lock_result.shells_spent_total,
    lock_result.lock_delta
  from public.messages as message where message.id = p_message_id;
end;
$$;

create or replace function public.set_message_reaction_with_cost(
  p_message_id uuid,
  p_bitcoin_address text,
  p_action text
)
returns table (
  active boolean,
  new_balance numeric,
  shells_spent_total numeric,
  cost numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.user_balances%rowtype;
  lock_result record;
  has_like boolean := false;
  has_dislike boolean := false;
  desired_kind text;
  charged_new boolean := false;
begin
  if p_action not in ('like', 'dislike', 'remove_like', 'remove_dislike') then
    raise exception 'Action inconnue';
  end if;

  select * into account
  from public.user_balances as balance
  where balance.bitcoin_address = p_bitcoin_address
  for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;

  select
    exists(select 1 from public.message_likes where message_id = p_message_id and bitcoin_address = p_bitcoin_address),
    exists(select 1 from public.message_dislikes where message_id = p_message_id and bitcoin_address = p_bitcoin_address)
  into has_like, has_dislike;

  if p_action in ('remove_like', 'remove_dislike') then
    if p_action = 'remove_like' and has_like then
      delete from public.message_likes where message_id = p_message_id and bitcoin_address = p_bitcoin_address;
    elsif p_action = 'remove_dislike' and has_dislike then
      delete from public.message_dislikes where message_id = p_message_id and bitcoin_address = p_bitcoin_address;
    else
      return query select false, account.shells_balance,
        coalesce(account.shells_spent_total, 0), 0::numeric;
      return;
    end if;
    select * into lock_result from private.set_refundable_shell_lock(
      p_bitcoin_address, 'reaction', p_message_id::text, 0
    );
    return query select false, lock_result.new_balance,
      lock_result.shells_spent_total, lock_result.lock_delta;
    return;
  end if;

  if not exists (
    select 1 from public.messages where id = p_message_id and deleted_at is null
  ) then raise exception 'Message introuvable'; end if;

  desired_kind := p_action;
  if (desired_kind = 'like' and has_like) or (desired_kind = 'dislike' and has_dislike) then
    return query select true, account.shells_balance,
      coalesce(account.shells_spent_total, 0), 0::numeric;
    return;
  end if;

  if has_like or has_dislike then
    delete from public.message_likes where message_id = p_message_id and bitcoin_address = p_bitcoin_address;
    delete from public.message_dislikes where message_id = p_message_id and bitcoin_address = p_bitcoin_address;
  else
    select * into lock_result from private.set_refundable_shell_lock(
      p_bitcoin_address, 'reaction', p_message_id::text, 1
    );
    charged_new := true;
  end if;

  if desired_kind = 'like' then
    insert into public.message_likes (message_id, bitcoin_address) values (p_message_id, p_bitcoin_address);
  else
    insert into public.message_dislikes (message_id, bitcoin_address) values (p_message_id, p_bitcoin_address);
  end if;

  if charged_new then
    return query select true, lock_result.new_balance,
      lock_result.shells_spent_total, lock_result.lock_delta;
  else
    return query select true, account.shells_balance,
      coalesce(account.shells_spent_total, 0), 0::numeric;
  end if;
end;
$$;

create or replace function public.set_follow_with_lock(
  p_follower_address text,
  p_following_address text,
  p_should_follow boolean
)
returns table (
  active boolean,
  new_balance numeric,
  lock_delta numeric,
  shells_spent_total numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.user_balances%rowtype;
  lock_result record;
  relationship_exists boolean := false;
begin
  if p_follower_address = p_following_address then
    raise exception 'Vous ne pouvez pas suivre votre propre compte';
  end if;
  if not exists (
    select 1 from public.user_balances where bitcoin_address = p_following_address
  ) then raise exception 'Compte introuvable'; end if;

  select * into account
  from public.user_balances as balance
  where balance.bitcoin_address = p_follower_address
  for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;

  if p_should_follow and exists (
    select 1
    from public.editorial_author_preferences as preference
    where preference.preference = 'block'
      and (
        (preference.reader_address = p_follower_address
          and preference.target_address = p_following_address)
        or (preference.reader_address = p_following_address
          and preference.target_address = p_follower_address)
      )
  ) then raise exception 'Interaction impossible entre ces comptes'; end if;

  select exists (
    select 1 from public.follows
    where follower_address = p_follower_address
      and following_address = p_following_address
  ) into relationship_exists;

  if p_should_follow and relationship_exists then
    return query select true, account.shells_balance, 0::numeric,
      coalesce(account.shells_spent_total, 0);
    return;
  end if;

  if p_should_follow then
    select * into lock_result from private.set_refundable_shell_lock(
      p_follower_address, 'follow', p_following_address, 10
    );
    insert into public.follows (follower_address, following_address, created_at)
    values (p_follower_address, p_following_address, now());
    return query select true, lock_result.new_balance, lock_result.lock_delta,
      lock_result.shells_spent_total;
    return;
  end if;

  delete from public.follows
  where follower_address = p_follower_address
    and following_address = p_following_address;
  select * into lock_result from private.set_refundable_shell_lock(
    p_follower_address, 'follow', p_following_address, 0
  );
  return query select false, lock_result.new_balance, lock_result.lock_delta,
    lock_result.shells_spent_total;
end;
$$;

revoke all on function public.toggle_message_useful_with_cost(uuid, text)
  from public, anon, authenticated;
revoke all on function public.set_message_reaction_with_cost(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.set_follow_with_lock(text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.toggle_message_useful_with_cost(uuid, text) to service_role;
grant execute on function public.set_message_reaction_with_cost(uuid, text, text) to service_role;
grant execute on function public.set_follow_with_lock(text, text, boolean) to service_role;

-- Blocking reverses both possible follow relationships. Lock both balance rows
-- in a deterministic order before releasing their reserves so simultaneous
-- opposite actions cannot deadlock or leave an orphaned follow lock.
create or replace function public.set_editorial_author_preference(
  p_reader_address text,
  p_target_address text,
  p_preference text
)
returns table (preference text, active boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  released_lock record;
begin
  if p_reader_address is null or p_target_address is null then
    raise exception 'Contexte éditorial incomplet';
  end if;
  if p_reader_address = p_target_address then
    raise exception 'Vous ne pouvez pas appliquer ce choix à votre propre compte';
  end if;
  if not exists (
    select 1 from public.user_balances where bitcoin_address = p_reader_address
  ) or not exists (
    select 1 from public.user_balances where bitcoin_address = p_target_address
  ) then raise exception 'Compte introuvable'; end if;

  if p_preference is null or p_preference = 'none' then
    delete from public.editorial_author_preferences
    where reader_address = p_reader_address and target_address = p_target_address;
    return query select 'none'::text, false;
    return;
  end if;
  if p_preference not in ('reduce', 'mute', 'block') then
    raise exception 'Choix éditorial invalide';
  end if;

  if p_preference = 'block' then
    perform 1
    from public.user_balances
    where bitcoin_address in (p_reader_address, p_target_address)
    order by bitcoin_address
    for update;

    delete from public.follows
    where (follower_address = p_reader_address and following_address = p_target_address)
       or (follower_address = p_target_address and following_address = p_reader_address);

    select * into released_lock from private.set_refundable_shell_lock(
      p_reader_address, 'follow', p_target_address, 0
    );
    select * into released_lock from private.set_refundable_shell_lock(
      p_target_address, 'follow', p_reader_address, 0
    );
  end if;

  insert into public.editorial_author_preferences (
    reader_address, target_address, preference, created_at, updated_at
  ) values (
    p_reader_address, p_target_address, p_preference, now(), now()
  )
  on conflict (reader_address, target_address) do update set
    preference = excluded.preference,
    updated_at = now();

  return query select p_preference, true;
end;
$$;

revoke all on function public.set_editorial_author_preference(text, text, text)
  from public, anon, authenticated;
grant execute on function public.set_editorial_author_preference(text, text, text)
  to service_role;

create or replace function public.set_profile_media_size_lock(
  p_bitcoin_address text,
  p_media_kind text,
  p_bytes bigint,
  p_pixels bigint,
  p_public_url text,
  p_object_key text
)
returns table (
  new_balance numeric,
  locked_kib bigint,
  lock_delta numeric,
  old_object_key text,
  shells_spent_total numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_amount bigint := 0;
  old_key text;
  lock_result record;
begin
  if p_media_kind not in ('avatar', 'cover') then raise exception 'Type de média invalide'; end if;
  if p_bytes < 0 or p_bytes > 5242880 then raise exception 'Taille d''image invalide'; end if;
  if p_pixels < 0 or p_pixels > 67108864 then raise exception 'Dimensions d''image invalides'; end if;
  if (p_bytes = 0 and (p_pixels <> 0 or p_public_url is not null or p_object_key is not null))
    or (p_bytes > 0 and (p_pixels = 0 or p_public_url is null or p_object_key is null)) then
    raise exception 'Média incomplet';
  end if;
  new_amount := case when p_bytes = 0 then 0 else ceil(p_bytes::numeric / 1024)::bigint end;

  perform 1 from public.user_balances
  where bitcoin_address = p_bitcoin_address for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;

  if p_media_kind = 'avatar' then
    select profile.avatar_object_key into old_key
    from public.user_profiles as profile
    where profile.bitcoin_address = p_bitcoin_address
    for update;
  else
    select profile.cover_object_key into old_key
    from public.user_profiles as profile
    where profile.bitcoin_address = p_bitcoin_address
    for update;
  end if;
  if not found then raise exception 'Profil introuvable'; end if;

  select * into lock_result from private.set_refundable_shell_lock(
    p_bitcoin_address, 'profile_media', p_media_kind, new_amount
  );

  if p_media_kind = 'avatar' then
    update public.user_profiles as profile
    set avatar_url = p_public_url,
      avatar_object_key = p_object_key,
      avatar_pixels = p_pixels,
      avatar_bytes = p_bytes,
      updated_at = now()
    where profile.bitcoin_address = p_bitcoin_address;
  else
    update public.user_profiles as profile
    set cover_url = p_public_url,
      cover_object_key = p_object_key,
      cover_pixels = p_pixels,
      cover_bytes = p_bytes,
      updated_at = now()
    where profile.bitcoin_address = p_bitcoin_address;
  end if;

  return query select
    lock_result.new_balance,
    new_amount,
    lock_result.lock_delta,
    old_key,
    lock_result.shells_spent_total;
end;
$$;

revoke all on function public.set_profile_media_size_lock(text, text, bigint, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.set_profile_media_size_lock(text, text, bigint, bigint, text, text)
  to service_role;

create or replace function public.publish_message_with_media_cost(
  p_bitcoin_address text,
  p_content text,
  p_parent_id uuid default null,
  p_media jsonb default '[]'::jsonb
)
returns table (
  created_message jsonb,
  btc_balance numeric,
  new_balance numeric,
  shells_spent_total numeric,
  cost numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.user_balances%rowtype;
  inserted_message public.messages%rowtype;
  normalized_media jsonb := coalesce(p_media, '[]'::jsonb);
  media_item jsonb;
  byte_count bigint;
  character_count integer;
  text_cost numeric;
  media_cost numeric := 0;
  message_cost numeric;
  lock_result record;
  final_balance numeric;
  final_spent numeric;
begin
  if jsonb_typeof(normalized_media) <> 'array'
    or jsonb_array_length(normalized_media) > 3 then
    raise exception 'Médias de publication invalides';
  end if;
  if (p_content is null or btrim(p_content) = '')
    and jsonb_array_length(normalized_media) = 0 then
    raise exception 'La publication ne peut pas être vide';
  end if;
  if char_length(coalesce(p_content, '')) > 1000 then
    raise exception 'Le message ne peut pas dépasser 1000 caractères';
  end if;
  if p_parent_id is not null and jsonb_array_length(normalized_media) > 0 then
    raise exception 'Les photos sont réservées aux publications';
  end if;
  if p_parent_id is not null and not exists (
    select 1 from public.messages where id = p_parent_id and deleted_at is null
  ) then raise exception 'Publication parente introuvable'; end if;

  for media_item in select value from jsonb_array_elements(normalized_media)
  loop
    if jsonb_typeof(media_item) <> 'object'
      or not (media_item ? 'bytes')
      or (media_item ->> 'bytes') !~ '^[0-9]+$' then
      raise exception 'Taille de photo invalide';
    end if;
    byte_count := (media_item ->> 'bytes')::bigint;
    if byte_count < 1 or byte_count > 614400 then raise exception 'Taille de photo invalide'; end if;
    media_cost := media_cost + ceil(byte_count::numeric / 1024);
  end loop;

  character_count := char_length(replace(coalesce(p_content, ''), E'\n', ''));
  text_cost := character_count;
  message_cost := text_cost + media_cost;

  select * into account from public.user_balances
  where bitcoin_address = p_bitcoin_address for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;
  if account.shells_balance < message_cost then raise exception 'INSUFFICIENT_SHELLS'; end if;

  insert into public.messages (
    bitcoin_address, content, char_count, cost_shells, parent_id, media, created_at
  ) values (
    p_bitcoin_address, coalesce(p_content, ''), character_count,
    message_cost, p_parent_id, normalized_media, now()
  ) returning * into inserted_message;

  final_balance := account.shells_balance;
  final_spent := coalesce(account.shells_spent_total, 0);
  if text_cost > 0 then
    select * into lock_result from private.set_refundable_shell_lock(
      p_bitcoin_address, 'message_text', inserted_message.id::text, text_cost
    );
    final_balance := lock_result.new_balance;
    final_spent := lock_result.shells_spent_total;
  end if;
  if media_cost > 0 then
    select * into lock_result from private.set_refundable_shell_lock(
      p_bitcoin_address, 'message_media', inserted_message.id::text, media_cost
    );
    final_balance := lock_result.new_balance;
    final_spent := lock_result.shells_spent_total;
  end if;

  return query select to_jsonb(inserted_message), coalesce(account.btc_balance, 0),
    final_balance, final_spent, message_cost;
end;
$$;

revoke all on function public.publish_message_with_media_cost(text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_message_with_media_cost(text, text, uuid, jsonb)
  to service_role;

create or replace function public.toggle_or_create_message_repost(
  p_bitcoin_address text,
  p_target_message_id uuid,
  p_quote_content text default null
)
returns table(
  active boolean,
  repost_count bigint,
  new_balance numeric,
  shells_spent_total numeric,
  created_message jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_message public.messages%rowtype;
  account public.user_balances%rowtype;
  inserted_message public.messages%rowtype;
  existing_repost public.messages%rowtype;
  original_target_id uuid;
  cleaned_quote text := nullif(btrim(coalesce(p_quote_content, '')), '');
  billed_character_count integer := 0;
  repost_cost numeric := 0;
  lock_result record;
  media_release record;
  final_balance numeric;
  final_spent numeric;
begin
  select * into target_message from public.messages
  where id = p_target_message_id and deleted_at is null;
  if not found then raise exception 'Publication introuvable'; end if;

  original_target_id := coalesce(target_message.repost_of, target_message.id);
  if original_target_id <> target_message.id then
    select * into target_message from public.messages
    where id = original_target_id and deleted_at is null;
    if not found then raise exception 'Publication originale introuvable'; end if;
  end if;
  if target_message.bitcoin_address = p_bitcoin_address then
    raise exception 'Vous ne pouvez pas reposter votre propre publication';
  end if;

  select * into account from public.user_balances
  where bitcoin_address = p_bitcoin_address for update;
  if not found then raise exception 'Utilisateur non trouvé'; end if;

  if cleaned_quote is null then
    select * into existing_repost from public.messages
    where bitcoin_address = p_bitcoin_address
      and repost_of = original_target_id
      and repost_kind = 'simple'
      and deleted_at is null
    limit 1 for update;
    if found then
      update public.messages set deleted_at = now() where id = existing_repost.id;
      select * into lock_result from private.set_refundable_shell_lock(
        p_bitcoin_address, 'message_text', existing_repost.id::text, 0
      );
      select * into media_release from private.set_refundable_shell_lock(
        p_bitcoin_address, 'message_media', existing_repost.id::text, 0
      );
      return query select false,
        (select count(*) from public.messages where repost_of = original_target_id and deleted_at is null),
        media_release.new_balance, media_release.shells_spent_total, null::jsonb;
      return;
    end if;
  elsif char_length(cleaned_quote) > 1000 then
    raise exception 'La citation ne peut pas dépasser 1000 caractères';
  end if;

  billed_character_count := char_length(replace(coalesce(target_message.content, ''), E'\n', ''))
    + char_length(replace(coalesce(cleaned_quote, ''), E'\n', ''));
  repost_cost := billed_character_count;
  if account.shells_balance < repost_cost then raise exception 'INSUFFICIENT_SHELLS'; end if;

  insert into public.messages (
    bitcoin_address, content, char_count, cost_shells, created_at, repost_of, repost_kind
  ) values (
    p_bitcoin_address, coalesce(cleaned_quote, ''), billed_character_count,
    repost_cost, now(), original_target_id,
    case when cleaned_quote is null then 'simple' else 'quote' end
  ) returning * into inserted_message;

  final_balance := account.shells_balance;
  final_spent := coalesce(account.shells_spent_total, 0);
  if repost_cost > 0 then
    select * into lock_result from private.set_refundable_shell_lock(
      p_bitcoin_address, 'message_text', inserted_message.id::text, repost_cost
    );
    final_balance := lock_result.new_balance;
    final_spent := lock_result.shells_spent_total;
  end if;

  return query select true,
    (select count(*) from public.messages where repost_of = original_target_id and deleted_at is null),
    final_balance, final_spent, to_jsonb(inserted_message);
end;
$$;

create or replace function public.delete_message_and_release_locks(
  p_bitcoin_address text,
  p_message_id uuid
)
returns table (
  new_balance numeric,
  refunded_text numeric,
  refunded_media numeric,
  message_media jsonb,
  shells_spent_total numeric,
  already_deleted boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.user_balances%rowtype;
  target_message public.messages%rowtype;
  text_release record;
  media_release record;
begin
  select * into account from public.user_balances
  where bitcoin_address = p_bitcoin_address for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;

  select * into target_message from public.messages
  where id = p_message_id and bitcoin_address = p_bitcoin_address for update;
  if not found then raise exception 'Publication introuvable'; end if;
  if target_message.deleted_at is not null then
    return query select account.shells_balance, 0::numeric, 0::numeric, '[]'::jsonb,
      coalesce(account.shells_spent_total, 0), true;
    return;
  end if;

  update public.messages set deleted_at = now() where id = p_message_id;
  select * into text_release from private.set_refundable_shell_lock(
    p_bitcoin_address, 'message_text', p_message_id::text, 0
  );
  select * into media_release from private.set_refundable_shell_lock(
    p_bitcoin_address, 'message_media', p_message_id::text, 0
  );

  return query select media_release.new_balance,
    text_release.refunded_amount,
    media_release.refunded_amount,
    coalesce(target_message.media, '[]'::jsonb),
    media_release.shells_spent_total,
    false;
end;
$$;

revoke all on function public.toggle_or_create_message_repost(text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.delete_message_and_release_locks(text, uuid)
  from public, anon, authenticated;
grant execute on function public.toggle_or_create_message_repost(text, uuid, text)
  to service_role;
grant execute on function public.delete_message_and_release_locks(text, uuid)
  to service_role;
