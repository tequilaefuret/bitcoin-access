-- Make the product unit literal: one satoshi equals one shell.
-- Historical shell-denominated values used BTC decimals, so convert them once.
update public.user_balances
set
  shells_balance = round(coalesce(shells_balance, 0) * 100000000),
  shells_spent_total = round(coalesce(shells_spent_total, 0) * 100000000);

update public.messages
set cost_shells = round(coalesce(cost_shells, 0) * 100000000);

update public.transactions
set amount = round(coalesce(amount, 0) * 100000000);

update public.billing_idempotency_requests
set response_payload = jsonb_set(
  jsonb_set(
    jsonb_set(
      response_payload,
      '{cost}',
      to_jsonb(round(coalesce((response_payload ->> 'cost')::numeric, 0) * 100000000)),
      true
    ),
    '{new_balance}',
    to_jsonb(round(coalesce((response_payload ->> 'new_balance')::numeric, 0) * 100000000)),
    true
  ),
  '{shells_spent_total}',
  to_jsonb(round(coalesce((response_payload ->> 'shells_spent_total')::numeric, 0) * 100000000)),
  true
)
where response_payload ? 'cost';

alter table public.user_profiles
  add column if not exists avatar_pixels bigint not null default 0,
  add column if not exists cover_pixels bigint not null default 0,
  add column if not exists avatar_object_key text,
  add column if not exists cover_object_key text;

create table if not exists public.shell_locks (
  owner_address text not null
    references public.user_balances(bitcoin_address) on delete cascade,
  lock_kind text not null,
  lock_key text not null,
  amount numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_address, lock_kind, lock_key),
  constraint shell_locks_kind_check check (lock_kind in ('profile_media', 'follow')),
  constraint shell_locks_amount_check check (amount >= 0 and amount = trunc(amount))
);

create index if not exists shell_locks_kind_key_idx
  on public.shell_locks (lock_kind, lock_key);

alter table public.shell_locks enable row level security;
revoke all on table public.shell_locks from public, anon, authenticated;
grant select, insert, update, delete on table public.shell_locks to service_role;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_profiles_avatar_pixels_check') then
    alter table public.user_profiles add constraint user_profiles_avatar_pixels_check
      check (avatar_pixels >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_profiles_cover_pixels_check') then
    alter table public.user_profiles add constraint user_profiles_cover_pixels_check
      check (cover_pixels >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_balances_shells_integer_check') then
    alter table public.user_balances add constraint user_balances_shells_integer_check
      check (shells_balance >= 0 and shells_balance = trunc(shells_balance)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_balances_spent_integer_check') then
    alter table public.user_balances add constraint user_balances_spent_integer_check
      check (shells_spent_total >= 0 and shells_spent_total = trunc(shells_spent_total)) not valid;
  end if;
end $$;

alter table public.user_balances validate constraint user_balances_shells_integer_check;
alter table public.user_balances validate constraint user_balances_spent_integer_check;

create or replace function public.publish_message_with_cost(
  p_bitcoin_address text,
  p_content text,
  p_parent_id uuid default null
)
returns table (
  created_message jsonb, btc_balance numeric, new_balance numeric,
  shells_spent_total numeric, cost numeric
)
language plpgsql security definer set search_path = ''
as $$
declare
  account public.user_balances%rowtype;
  inserted_message public.messages%rowtype;
  character_count integer;
  message_cost numeric;
begin
  if p_content is null or btrim(p_content) = '' then raise exception 'Le message ne peut pas être vide'; end if;
  if char_length(p_content) > 1000 then raise exception 'Le message ne peut pas dépasser 1000 caractères'; end if;
  if p_parent_id is not null and not exists (
    select 1 from public.messages where id = p_parent_id and deleted_at is null
  ) then raise exception 'Publication parente introuvable'; end if;

  character_count := char_length(replace(p_content, E'\n', ''));
  message_cost := character_count;

  select * into account from public.user_balances
  where bitcoin_address = p_bitcoin_address for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;
  if account.shells_balance < message_cost then raise exception 'INSUFFICIENT_SHELLS'; end if;

  insert into public.messages (bitcoin_address, content, char_count, cost_shells, parent_id, created_at)
  values (p_bitcoin_address, p_content, character_count, message_cost, p_parent_id, now())
  returning * into inserted_message;

  update public.user_balances set
    shells_balance = account.shells_balance - message_cost,
    shells_spent_total = coalesce(account.shells_spent_total, 0) + message_cost,
    last_sync = now()
  where bitcoin_address = p_bitcoin_address;
  if message_cost > 0 then
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_bitcoin_address, -message_cost, 'message', now());
  end if;
  return query select to_jsonb(inserted_message), coalesce(account.btc_balance, 0),
    account.shells_balance - message_cost,
    coalesce(account.shells_spent_total, 0) + message_cost, message_cost;
end;
$$;

create or replace function public.charge_message_batch(p_bitcoin_address text, p_message_ids uuid[])
returns table (charged_count integer, new_balance numeric, shells_spent_total numeric, cost numeric)
language plpgsql security definer set search_path = ''
as $$
declare
  account public.user_balances%rowtype;
  item_count integer;
  batch_cost numeric;
begin
  -- Only real, visible publications written by somebody else are billable.
  select count(distinct message.id)::integer into item_count
  from unnest(coalesce(p_message_ids, array[]::uuid[])) as requested(message_id)
  join public.messages as message on message.id = requested.message_id
  where message.deleted_at is null and message.bitcoin_address <> p_bitcoin_address;
  if coalesce(array_length(p_message_ids, 1), 0) > 200 then
    raise exception 'Un lot de lecture ne peut pas dépasser 200 publications';
  end if;
  batch_cost := coalesce(item_count, 0);
  select * into account from public.user_balances
  where bitcoin_address = p_bitcoin_address for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;
  if account.shells_balance < batch_cost then raise exception 'INSUFFICIENT_SHELLS'; end if;
  if batch_cost > 0 then
    update public.user_balances set
      shells_balance = account.shells_balance - batch_cost,
      shells_spent_total = coalesce(account.shells_spent_total, 0) + batch_cost,
      last_sync = now()
    where bitcoin_address = p_bitcoin_address;
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_bitcoin_address, -batch_cost, 'read_messages', now());
  end if;
  return query select coalesce(item_count, 0), account.shells_balance - batch_cost,
    coalesce(account.shells_spent_total, 0) + batch_cost, batch_cost;
end;
$$;

create or replace function public.reconcile_bitcoin_balance_v2(
  p_bitcoin_address text, p_btc_balance numeric, p_observed_at timestamptz
)
returns table (
  bitcoin_address text, btc_balance numeric, shells_balance numeric,
  shells_spent_total numeric, last_sync timestamptz, balance_delta numeric,
  btc_balance_observed_at timestamptz, applied boolean
)
language plpgsql security definer set search_path = ''
as $$
declare
  account public.user_balances%rowtype;
  observed_balance numeric;
  delta_shells numeric;
  reconciled_shells numeric;
  synchronized_at timestamptz := now();
begin
  if p_btc_balance is null or p_btc_balance < 0 then raise exception 'Solde Bitcoin observé invalide'; end if;
  if p_observed_at is null or p_observed_at > now() + interval '5 minutes' then
    raise exception 'Horodatage d''observation Bitcoin invalide';
  end if;
  observed_balance := round(p_btc_balance, 8);
  select * into account from public.user_balances as balance
  where balance.bitcoin_address = p_bitcoin_address for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;
  if account.btc_balance_observed_at is not null and p_observed_at <= account.btc_balance_observed_at then
    return query select p_bitcoin_address, coalesce(account.btc_balance, 0),
      coalesce(account.shells_balance, 0), coalesce(account.shells_spent_total, 0),
      account.last_sync, 0::numeric, account.btc_balance_observed_at, false;
    return;
  end if;
  delta_shells := round((observed_balance - coalesce(account.btc_balance, 0)) * 100000000);
  reconciled_shells := greatest(0, coalesce(account.shells_balance, 0) + delta_shells);
  update public.user_balances as balance set btc_balance = observed_balance,
    shells_balance = reconciled_shells, last_sync = synchronized_at,
    btc_balance_observed_at = p_observed_at
  where balance.bitcoin_address = p_bitcoin_address;
  if delta_shells <> 0 then
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_bitcoin_address, delta_shells, 'sync', synchronized_at);
  end if;
  return query select p_bitcoin_address, observed_balance, reconciled_shells,
    coalesce(account.shells_spent_total, 0), synchronized_at, delta_shells,
    p_observed_at, true;
end;
$$;

create or replace function public.reconcile_bitcoin_balance(p_bitcoin_address text, p_btc_balance numeric)
returns table (
  bitcoin_address text, btc_balance numeric, shells_balance numeric,
  shells_spent_total numeric, last_sync timestamptz, balance_delta numeric
)
language plpgsql security definer set search_path = ''
as $$
declare
  account public.user_balances%rowtype;
  observed_balance numeric;
  delta_shells numeric;
  reconciled_shells numeric;
  synchronized_at timestamptz := now();
begin
  if p_btc_balance is null or p_btc_balance < 0 then raise exception 'Solde Bitcoin observé invalide'; end if;
  observed_balance := round(p_btc_balance, 8);
  select * into account from public.user_balances as balance
  where balance.bitcoin_address = p_bitcoin_address for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;
  delta_shells := round((observed_balance - coalesce(account.btc_balance, 0)) * 100000000);
  reconciled_shells := greatest(0, coalesce(account.shells_balance, 0) + delta_shells);
  update public.user_balances as balance set btc_balance = observed_balance, shells_balance = reconciled_shells,
    last_sync = synchronized_at where balance.bitcoin_address = p_bitcoin_address;
  if delta_shells <> 0 then
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_bitcoin_address, delta_shells, 'sync', synchronized_at);
  end if;
  return query select p_bitcoin_address, observed_balance, reconciled_shells,
    coalesce(account.shells_spent_total, 0), synchronized_at, delta_shells;
end;
$$;

create or replace function public.toggle_message_useful_with_cost(p_message_id uuid, p_bitcoin_address text)
returns table (active boolean, useful_count integer, new_balance numeric, shells_spent_total numeric, cost numeric)
language plpgsql security definer set search_path = ''
as $$
declare
  useful_cost constant numeric := 1;
  message_author text;
  balance_before numeric;
  spent_before numeric;
begin
  select bitcoin_address into message_author from public.messages
  where id = p_message_id and deleted_at is null;
  if not found then raise exception 'Message introuvable'; end if;
  if message_author = p_bitcoin_address then raise exception 'Vous ne pouvez pas marquer votre propre publication comme utile'; end if;
  select coalesce(shells_balance, 0), coalesce(shells_spent_total, 0)
  into balance_before, spent_before from public.user_balances
  where bitcoin_address = p_bitcoin_address for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;
  if exists (select 1 from public.message_useful_votes where message_id = p_message_id and bitcoin_address = p_bitcoin_address) then
    delete from public.message_useful_votes where message_id = p_message_id and bitcoin_address = p_bitcoin_address;
    return query select false, coalesce(message.useful_count, 0), balance_before, spent_before, 0::numeric
      from public.messages as message where message.id = p_message_id;
    return;
  end if;
  if balance_before < useful_cost then raise exception 'INSUFFICIENT_SHELLS'; end if;
  update public.user_balances set shells_balance = balance_before - useful_cost,
    shells_spent_total = spent_before + useful_cost, last_sync = now()
  where bitcoin_address = p_bitcoin_address;
  insert into public.message_useful_votes (message_id, bitcoin_address) values (p_message_id, p_bitcoin_address);
  insert into public.transactions (bitcoin_address, amount, type, created_at)
  values (p_bitcoin_address, -useful_cost, 'social_useful', now());
  return query select true, coalesce(message.useful_count, 0), balance_before - useful_cost,
    spent_before + useful_cost, useful_cost from public.messages as message where message.id = p_message_id;
end;
$$;

create or replace function public.charge_game(p_bitcoin_address text)
returns table (bitcoin_address text, btc_balance numeric, shells_balance numeric, shells_spent_total numeric, last_sync timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  game_cost constant numeric := 100;
  account public.user_balances%rowtype;
begin
  select * into account from public.user_balances as balance
  where balance.bitcoin_address = p_bitcoin_address for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;
  if account.shells_balance < game_cost then raise exception 'INSUFFICIENT_SHELLS'; end if;
  update public.user_balances as balance set shells_balance = account.shells_balance - game_cost,
    shells_spent_total = coalesce(account.shells_spent_total, 0) + game_cost, last_sync = now()
  where balance.bitcoin_address = p_bitcoin_address;
  insert into public.transactions (bitcoin_address, amount, type, game_score, created_at)
  values (p_bitcoin_address, -game_cost, 'game', null, now());
  return query select p_bitcoin_address, coalesce(account.btc_balance, 0),
    account.shells_balance - game_cost, coalesce(account.shells_spent_total, 0) + game_cost, now();
end;
$$;

create or replace function public.toggle_or_create_message_repost(
  p_bitcoin_address text, p_target_message_id uuid, p_quote_content text default null
)
returns table(active boolean, repost_count bigint, new_balance numeric, shells_spent_total numeric, created_message jsonb)
language plpgsql security definer set search_path = ''
as $$
declare
  target_message public.messages%rowtype;
  account public.user_balances%rowtype;
  inserted_message public.messages%rowtype;
  existing_repost_id uuid;
  original_target_id uuid;
  cleaned_quote text := nullif(btrim(coalesce(p_quote_content, '')), '');
  billed_character_count integer := 0;
  repost_cost numeric := 0;
begin
  select * into target_message from public.messages where id = p_target_message_id and deleted_at is null;
  if not found then raise exception 'Publication introuvable'; end if;
  original_target_id := coalesce(target_message.repost_of, target_message.id);
  if original_target_id <> target_message.id then
    select * into target_message from public.messages where id = original_target_id and deleted_at is null;
    if not found then raise exception 'Publication originale introuvable'; end if;
  end if;
  if target_message.bitcoin_address = p_bitcoin_address then raise exception 'Vous ne pouvez pas reposter votre propre publication'; end if;
  select * into account from public.user_balances where bitcoin_address = p_bitcoin_address for update;
  if not found then raise exception 'Utilisateur non trouvé'; end if;
  if cleaned_quote is null then
    select id into existing_repost_id from public.messages where bitcoin_address = p_bitcoin_address
      and repost_of = original_target_id and repost_kind = 'simple' and deleted_at is null limit 1;
    if existing_repost_id is not null then
      delete from public.messages where id = existing_repost_id;
      return query select false,
        (select count(*) from public.messages where repost_of = original_target_id and deleted_at is null),
        account.shells_balance, coalesce(account.shells_spent_total, 0), null::jsonb;
      return;
    end if;
  elsif char_length(cleaned_quote) > 1000 then raise exception 'La citation ne peut pas dépasser 1000 caractères';
  end if;
  billed_character_count := char_length(replace(coalesce(target_message.content, ''), E'\n', ''))
    + char_length(replace(coalesce(cleaned_quote, ''), E'\n', ''));
  repost_cost := billed_character_count;
  if account.shells_balance < repost_cost then raise exception 'INSUFFICIENT_SHELLS'; end if;
  insert into public.messages (bitcoin_address, content, char_count, cost_shells, created_at, repost_of, repost_kind)
  values (p_bitcoin_address, coalesce(cleaned_quote, ''), billed_character_count, repost_cost, now(), original_target_id,
    case when cleaned_quote is null then 'simple' else 'quote' end)
  returning * into inserted_message;
  if repost_cost > 0 then
    update public.user_balances set shells_balance = account.shells_balance - repost_cost,
      shells_spent_total = coalesce(account.shells_spent_total, 0) + repost_cost, last_sync = now()
    where bitcoin_address = p_bitcoin_address returning * into account;
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_bitcoin_address, -repost_cost, 'message', now());
  end if;
  return query select true,
    (select count(*) from public.messages where repost_of = original_target_id and deleted_at is null),
    account.shells_balance, coalesce(account.shells_spent_total, 0), to_jsonb(inserted_message);
end;
$$;

create or replace function public.set_message_reaction_with_cost(p_message_id uuid, p_bitcoin_address text, p_action text)
returns table(active boolean, new_balance numeric, shells_spent_total numeric, cost numeric)
language plpgsql security definer set search_path = ''
as $$
declare
  reaction_cost constant numeric := 1;
  balance_before numeric;
  spent_before numeric;
  already_active boolean;
begin
  if p_action not in ('like', 'dislike', 'remove_like', 'remove_dislike') then raise exception 'Action inconnue'; end if;
  if not exists (select 1 from public.messages where id = p_message_id and deleted_at is null) then raise exception 'Message introuvable'; end if;
  select coalesce(shells_balance, 0), coalesce(shells_spent_total, 0) into balance_before, spent_before
  from public.user_balances where bitcoin_address = p_bitcoin_address for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;
  if p_action = 'remove_like' then delete from public.message_likes where message_id = p_message_id and bitcoin_address = p_bitcoin_address; return query select false, balance_before, spent_before, 0::numeric; return; end if;
  if p_action = 'remove_dislike' then delete from public.message_dislikes where message_id = p_message_id and bitcoin_address = p_bitcoin_address; return query select false, balance_before, spent_before, 0::numeric; return; end if;
  if p_action = 'like' then select exists(select 1 from public.message_likes where message_id = p_message_id and bitcoin_address = p_bitcoin_address) into already_active;
  else select exists(select 1 from public.message_dislikes where message_id = p_message_id and bitcoin_address = p_bitcoin_address) into already_active; end if;
  if already_active then return query select true, balance_before, spent_before, 0::numeric; return; end if;
  if balance_before < reaction_cost then raise exception 'INSUFFICIENT_SHELLS'; end if;
  if p_action = 'like' then
    delete from public.message_dislikes where message_id = p_message_id and bitcoin_address = p_bitcoin_address;
    insert into public.message_likes (message_id, bitcoin_address) values (p_message_id, p_bitcoin_address);
  else
    delete from public.message_likes where message_id = p_message_id and bitcoin_address = p_bitcoin_address;
    insert into public.message_dislikes (message_id, bitcoin_address) values (p_message_id, p_bitcoin_address);
  end if;
  update public.user_balances set shells_balance = balance_before - reaction_cost,
    shells_spent_total = spent_before + reaction_cost, last_sync = now() where bitcoin_address = p_bitcoin_address;
  insert into public.transactions (bitcoin_address, amount, type, created_at)
  values (p_bitcoin_address, -reaction_cost, case when p_action = 'like' then 'social_like' else 'social_dislike' end, now());
  return query select true, balance_before - reaction_cost, spent_before + reaction_cost, reaction_cost;
end;
$$;

create or replace function public.set_profile_media_lock(
  p_bitcoin_address text, p_media_kind text, p_pixels bigint,
  p_public_url text, p_object_key text
)
returns table (
  new_balance numeric, locked_pixels bigint, lock_delta numeric,
  old_object_key text, shells_spent_total numeric
)
language plpgsql security definer set search_path = ''
as $$
declare
  account public.user_balances%rowtype;
  old_amount numeric := 0;
  backing_room numeric := 0;
  old_key text;
  delta numeric;
begin
  if p_media_kind not in ('avatar', 'cover') then raise exception 'Type de média invalide'; end if;
  if p_pixels < 0 or p_pixels > 67108864 then raise exception 'Dimensions d''image invalides'; end if;
  if (p_pixels = 0 and (p_public_url is not null or p_object_key is not null))
    or (p_pixels > 0 and (p_public_url is null or p_object_key is null)) then
    raise exception 'Média incomplet';
  end if;
  select * into account from public.user_balances where bitcoin_address = p_bitcoin_address for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;
  select amount into old_amount from public.shell_locks
  where owner_address = p_bitcoin_address and lock_kind = 'profile_media' and lock_key = p_media_kind;
  old_amount := coalesce(old_amount, 0);
  -- A refundable lock may never recreate more shells than the last observed
  -- Bitcoin backing. This also closes the withdrawal-then-unlock edge case.
  backing_room := greatest(
    0,
    round(coalesce(account.btc_balance, 0) * 100000000) - account.shells_balance
  );
  old_amount := least(old_amount, backing_room);
  if p_media_kind = 'avatar' then select avatar_object_key into old_key from public.user_profiles where bitcoin_address = p_bitcoin_address for update;
  else select cover_object_key into old_key from public.user_profiles where bitcoin_address = p_bitcoin_address for update;
  end if;
  if not found then raise exception 'Profil introuvable'; end if;
  delta := p_pixels - old_amount;
  if delta > account.shells_balance then raise exception 'INSUFFICIENT_SHELLS'; end if;
  update public.user_balances set shells_balance = account.shells_balance - delta, last_sync = now()
  where bitcoin_address = p_bitcoin_address;
  if p_pixels = 0 then
    delete from public.shell_locks where owner_address = p_bitcoin_address
      and lock_kind = 'profile_media' and lock_key = p_media_kind;
  else
    insert into public.shell_locks (owner_address, lock_kind, lock_key, amount)
    values (p_bitcoin_address, 'profile_media', p_media_kind, p_pixels)
    on conflict (owner_address, lock_kind, lock_key) do update
      set amount = excluded.amount, updated_at = now();
  end if;
  if p_media_kind = 'avatar' then
    update public.user_profiles set avatar_url = p_public_url, avatar_object_key = p_object_key,
      avatar_pixels = p_pixels, updated_at = now() where bitcoin_address = p_bitcoin_address;
  else
    update public.user_profiles set cover_url = p_public_url, cover_object_key = p_object_key,
      cover_pixels = p_pixels, updated_at = now() where bitcoin_address = p_bitcoin_address;
  end if;
  if delta <> 0 then
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_bitcoin_address, -delta, 'profile_media_lock', now());
  end if;
  return query select account.shells_balance - delta, p_pixels, delta, old_key,
    coalesce(account.shells_spent_total, 0);
end;
$$;

create or replace function public.set_follow_with_lock(
  p_follower_address text, p_following_address text, p_should_follow boolean
)
returns table (active boolean, new_balance numeric, lock_delta numeric, shells_spent_total numeric)
language plpgsql security definer set search_path = ''
as $$
declare
  follow_cost constant numeric := 10;
  account public.user_balances%rowtype;
  old_lock numeric := 0;
  backing_room numeric := 0;
  relationship_exists boolean;
begin
  if p_follower_address = p_following_address then raise exception 'Vous ne pouvez pas suivre votre propre compte'; end if;
  if not exists (select 1 from public.user_balances where bitcoin_address = p_following_address) then raise exception 'Compte introuvable'; end if;
  select * into account from public.user_balances where bitcoin_address = p_follower_address for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;
  select exists(select 1 from public.follows where follower_address = p_follower_address and following_address = p_following_address)
    into relationship_exists;
  select coalesce(amount, 0) into old_lock from public.shell_locks
  where owner_address = p_follower_address and lock_kind = 'follow' and lock_key = p_following_address;
  old_lock := coalesce(old_lock, 0);
  backing_room := greatest(
    0,
    round(coalesce(account.btc_balance, 0) * 100000000) - account.shells_balance
  );
  old_lock := least(old_lock, backing_room);
  if p_should_follow then
    if relationship_exists then return query select true, account.shells_balance, 0::numeric, coalesce(account.shells_spent_total, 0); return; end if;
    if account.shells_balance < follow_cost then raise exception 'INSUFFICIENT_SHELLS'; end if;
    insert into public.follows (follower_address, following_address, created_at)
    values (p_follower_address, p_following_address, now());
    insert into public.shell_locks (owner_address, lock_kind, lock_key, amount)
    values (p_follower_address, 'follow', p_following_address, follow_cost);
    update public.user_balances set shells_balance = account.shells_balance - follow_cost, last_sync = now()
    where bitcoin_address = p_follower_address;
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_follower_address, -follow_cost, 'follow_lock', now());
    return query select true, account.shells_balance - follow_cost, follow_cost, coalesce(account.shells_spent_total, 0);
  end if;
  if relationship_exists then delete from public.follows where follower_address = p_follower_address and following_address = p_following_address; end if;
  if old_lock > 0 then
    delete from public.shell_locks where owner_address = p_follower_address and lock_kind = 'follow' and lock_key = p_following_address;
    update public.user_balances set shells_balance = account.shells_balance + old_lock, last_sync = now()
    where bitcoin_address = p_follower_address;
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_follower_address, old_lock, 'follow_unlock', now());
  end if;
  return query select false, account.shells_balance + old_lock, -old_lock, coalesce(account.shells_spent_total, 0);
end;
$$;

-- Blocking removes both relationships and releases any corresponding locks.
create or replace function public.set_editorial_author_preference(
  p_reader_address text, p_target_address text, p_preference text
)
returns table (preference text, active boolean)
language plpgsql security definer set search_path = ''
as $$
begin
  if p_reader_address is null or p_target_address is null then raise exception 'Contexte éditorial incomplet'; end if;
  if p_reader_address = p_target_address then raise exception 'Vous ne pouvez pas appliquer ce choix à votre propre compte'; end if;
  if not exists (select 1 from public.user_balances where bitcoin_address = p_target_address) then raise exception 'Compte introuvable'; end if;
  if p_preference is null or p_preference = 'none' then
    delete from public.editorial_author_preferences where reader_address = p_reader_address and target_address = p_target_address;
    return query select 'none'::text, false; return;
  end if;
  if p_preference not in ('reduce', 'mute', 'block') then raise exception 'Choix éditorial invalide'; end if;
  if p_preference = 'block' then
    perform 1 from public.user_balances where bitcoin_address in (p_reader_address, p_target_address)
      order by bitcoin_address for update;
    perform public.set_follow_with_lock(p_reader_address, p_target_address, false);
    perform public.set_follow_with_lock(p_target_address, p_reader_address, false);
  end if;
  insert into public.editorial_author_preferences (reader_address, target_address, preference, created_at, updated_at)
  values (p_reader_address, p_target_address, p_preference, now(), now())
  on conflict (reader_address, target_address) do update set preference = excluded.preference, updated_at = now();
  return query select p_preference, true;
end;
$$;

revoke all on function public.publish_message_with_cost(text, text, uuid) from public, anon, authenticated;
revoke all on function public.charge_message_batch(text, uuid[]) from public, anon, authenticated;
revoke all on function public.reconcile_bitcoin_balance_v2(text, numeric, timestamptz) from public, anon, authenticated;
revoke all on function public.reconcile_bitcoin_balance(text, numeric) from public, anon, authenticated;
revoke all on function public.toggle_message_useful_with_cost(uuid, text) from public, anon, authenticated;
revoke all on function public.charge_game(text) from public, anon, authenticated;
revoke all on function public.toggle_or_create_message_repost(text, uuid, text) from public, anon, authenticated;
revoke all on function public.set_message_reaction_with_cost(uuid, text, text) from public, anon, authenticated;
revoke all on function public.set_profile_media_lock(text, text, bigint, text, text) from public, anon, authenticated;
revoke all on function public.set_follow_with_lock(text, text, boolean) from public, anon, authenticated;
revoke all on function public.set_editorial_author_preference(text, text, text) from public, anon, authenticated;
grant execute on function public.publish_message_with_cost(text, text, uuid) to service_role;
grant execute on function public.charge_message_batch(text, uuid[]) to service_role;
grant execute on function public.reconcile_bitcoin_balance_v2(text, numeric, timestamptz) to service_role;
grant execute on function public.reconcile_bitcoin_balance(text, numeric) to service_role;
grant execute on function public.toggle_message_useful_with_cost(uuid, text) to service_role;
grant execute on function public.charge_game(text) to service_role;
grant execute on function public.toggle_or_create_message_repost(text, uuid, text) to service_role;
grant execute on function public.set_message_reaction_with_cost(uuid, text, text) to service_role;
grant execute on function public.set_profile_media_lock(text, text, bigint, text, text) to service_role;
grant execute on function public.set_follow_with_lock(text, text, boolean) to service_role;
grant execute on function public.set_editorial_author_preference(text, text, text) to service_role;
