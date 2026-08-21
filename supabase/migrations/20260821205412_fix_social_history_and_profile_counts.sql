-- Display names are intentionally non-unique pseudonyms. Bitcoin ownership,
-- not a mutable label, remains the account identifier.
drop index if exists public.user_profiles_display_name_lower_unique;

-- Qualify every balance column because RETURNS TABLE output names are PL/pgSQL
-- variables too. The previous unqualified shells_spent_total reference raised
-- an ambiguity error and surfaced as a 500 from user-operations.
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
  useful_cost constant numeric := 1;
  message_author text;
  balance_before numeric;
  spent_before numeric;
begin
  select message.bitcoin_address
  into message_author
  from public.messages as message
  where message.id = p_message_id
    and message.deleted_at is null;

  if not found then raise exception 'Message introuvable'; end if;
  if message_author = p_bitcoin_address then
    raise exception 'Vous ne pouvez pas marquer votre propre publication comme utile';
  end if;

  select
    coalesce(balance.shells_balance, 0),
    coalesce(balance.shells_spent_total, 0)
  into balance_before, spent_before
  from public.user_balances as balance
  where balance.bitcoin_address = p_bitcoin_address
  for update;

  if not found then raise exception 'Utilisateur introuvable'; end if;

  if exists (
    select 1
    from public.message_useful_votes as vote
    where vote.message_id = p_message_id
      and vote.bitcoin_address = p_bitcoin_address
  ) then
    delete from public.message_useful_votes as vote
    where vote.message_id = p_message_id
      and vote.bitcoin_address = p_bitcoin_address;

    return query
    select false, coalesce(message.useful_count, 0), balance_before,
      spent_before, 0::numeric
    from public.messages as message
    where message.id = p_message_id;
    return;
  end if;

  if balance_before < useful_cost then raise exception 'INSUFFICIENT_SHELLS'; end if;

  update public.user_balances as balance
  set
    shells_balance = balance_before - useful_cost,
    shells_spent_total = spent_before + useful_cost,
    last_sync = now()
  where balance.bitcoin_address = p_bitcoin_address;

  insert into public.message_useful_votes (message_id, bitcoin_address)
  values (p_message_id, p_bitcoin_address);

  insert into public.transactions (bitcoin_address, amount, type, created_at)
  values (p_bitcoin_address, -useful_cost, 'social_useful', now());

  return query
  select true, coalesce(message.useful_count, 0),
    balance_before - useful_cost, spent_before + useful_cost, useful_cost
  from public.messages as message
  where message.id = p_message_id;
end;
$$;

-- Media uses refundable locks. Record replacement as a full unlock followed by
-- a full lock so the activity ledger explains both sides of the operation even
-- when the net balance change is small or zero.
create or replace function public.set_profile_media_lock(
  p_bitcoin_address text,
  p_media_kind text,
  p_pixels bigint,
  p_public_url text,
  p_object_key text
)
returns table (
  new_balance numeric,
  locked_pixels bigint,
  lock_delta numeric,
  old_object_key text,
  shells_spent_total numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.user_balances%rowtype;
  old_amount numeric := 0;
  backing_room numeric := 0;
  old_key text;
  delta numeric;
  lock_type text;
  unlock_type text;
begin
  if p_media_kind not in ('avatar', 'cover') then raise exception 'Type de média invalide'; end if;
  if p_pixels < 0 or p_pixels > 67108864 then raise exception 'Dimensions d''image invalides'; end if;
  if (p_pixels = 0 and (p_public_url is not null or p_object_key is not null))
    or (p_pixels > 0 and (p_public_url is null or p_object_key is null)) then
    raise exception 'Média incomplet';
  end if;

  select * into account
  from public.user_balances as balance
  where balance.bitcoin_address = p_bitcoin_address
  for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;

  select lock.amount into old_amount
  from public.shell_locks as lock
  where lock.owner_address = p_bitcoin_address
    and lock.lock_kind = 'profile_media'
    and lock.lock_key = p_media_kind;
  old_amount := coalesce(old_amount, 0);

  backing_room := greatest(
    0,
    round(coalesce(account.btc_balance, 0) * 100000000) - account.shells_balance
  );
  old_amount := least(old_amount, backing_room);

  if p_media_kind = 'avatar' then
    select profile.avatar_object_key into old_key
    from public.user_profiles as profile
    where profile.bitcoin_address = p_bitcoin_address
    for update;
    lock_type := 'profile_avatar_lock';
    unlock_type := 'profile_avatar_unlock';
  else
    select profile.cover_object_key into old_key
    from public.user_profiles as profile
    where profile.bitcoin_address = p_bitcoin_address
    for update;
    lock_type := 'profile_cover_lock';
    unlock_type := 'profile_cover_unlock';
  end if;
  if not found then raise exception 'Profil introuvable'; end if;

  delta := p_pixels - old_amount;
  if delta > account.shells_balance then raise exception 'INSUFFICIENT_SHELLS'; end if;

  update public.user_balances as balance
  set shells_balance = account.shells_balance - delta, last_sync = now()
  where balance.bitcoin_address = p_bitcoin_address;

  if p_pixels = 0 then
    delete from public.shell_locks as lock
    where lock.owner_address = p_bitcoin_address
      and lock.lock_kind = 'profile_media'
      and lock.lock_key = p_media_kind;
  else
    insert into public.shell_locks (owner_address, lock_kind, lock_key, amount)
    values (p_bitcoin_address, 'profile_media', p_media_kind, p_pixels)
    on conflict (owner_address, lock_kind, lock_key) do update
      set amount = excluded.amount, updated_at = now();
  end if;

  if p_media_kind = 'avatar' then
    update public.user_profiles as profile
    set avatar_url = p_public_url, avatar_object_key = p_object_key,
      avatar_pixels = p_pixels, updated_at = now()
    where profile.bitcoin_address = p_bitcoin_address;
  else
    update public.user_profiles as profile
    set cover_url = p_public_url, cover_object_key = p_object_key,
      cover_pixels = p_pixels, updated_at = now()
    where profile.bitcoin_address = p_bitcoin_address;
  end if;

  if old_amount > 0 then
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_bitcoin_address, old_amount, unlock_type, clock_timestamp());
  end if;
  if p_pixels > 0 then
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_bitcoin_address, -p_pixels, lock_type, clock_timestamp());
  end if;

  return query
  select account.shells_balance - delta, p_pixels, delta, old_key,
    coalesce(account.shells_spent_total, 0);
end;
$$;

revoke all on function public.toggle_message_useful_with_cost(uuid, text)
  from public, anon, authenticated;
revoke all on function public.set_profile_media_lock(text, text, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.toggle_message_useful_with_cost(uuid, text)
  to service_role;
grant execute on function public.set_profile_media_lock(text, text, bigint, text, text)
  to service_role;
