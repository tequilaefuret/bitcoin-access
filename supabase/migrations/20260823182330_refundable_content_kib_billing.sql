-- Bill stored media by kibibyte (1 KiB = 1 shell) and make active social
-- content refundable. R2 is inspected before these functions are called, so
-- the byte counts stored in message media are server-verified values.

alter table public.shell_locks
  drop constraint if exists shell_locks_kind_check;

alter table public.shell_locks
  add constraint shell_locks_kind_check check (
    lock_kind in ('profile_media', 'follow', 'message_text', 'message_media')
  );

alter table public.user_profiles
  add column if not exists avatar_bytes bigint not null default 0,
  add column if not exists cover_bytes bigint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_profiles_avatar_bytes_check'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_avatar_bytes_check check (avatar_bytes >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_profiles_cover_bytes_check'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_cover_bytes_check check (cover_bytes >= 0);
  end if;
end $$;

-- Existing profile locks were measured in pixels and cannot be translated to
-- bytes from PostgreSQL. Refund them once and grandfather the current files;
-- their exact KiB price is applied when they are next replaced. The refund is
-- capped by the current BTC backing, just like every later unlock.
do $$
declare
  owner record;
  account public.user_balances%rowtype;
  avatar_amount numeric;
  cover_amount numeric;
  backing_room numeric;
  avatar_refund numeric;
  cover_refund numeric;
begin
  for owner in
    select distinct lock.owner_address
    from public.shell_locks as lock
    where lock.lock_kind = 'profile_media'
    order by lock.owner_address
  loop
    select * into account
    from public.user_balances as balance
    where balance.bitcoin_address = owner.owner_address
    for update;

    if found then
      select
        coalesce(sum(lock.amount) filter (where lock.lock_key = 'avatar'), 0),
        coalesce(sum(lock.amount) filter (where lock.lock_key = 'cover'), 0)
      into avatar_amount, cover_amount
      from public.shell_locks as lock
      where lock.owner_address = owner.owner_address
        and lock.lock_kind = 'profile_media';

      backing_room := greatest(
        0,
        round(coalesce(account.btc_balance, 0) * 100000000) - account.shells_balance
      );
      avatar_refund := least(avatar_amount, backing_room);
      cover_refund := least(cover_amount, greatest(0, backing_room - avatar_refund));

      update public.user_balances as balance
      set
        shells_balance = account.shells_balance + avatar_refund + cover_refund,
        last_sync = now()
      where balance.bitcoin_address = owner.owner_address;

      if avatar_refund > 0 then
        insert into public.transactions (bitcoin_address, amount, type, created_at)
        values (owner.owner_address, avatar_refund, 'profile_avatar_unlock', clock_timestamp());
      end if;
      if cover_refund > 0 then
        insert into public.transactions (bitcoin_address, amount, type, created_at)
        values (owner.owner_address, cover_refund, 'profile_cover_unlock', clock_timestamp());
      end if;
    end if;
  end loop;
end $$;

delete from public.shell_locks where lock_kind = 'profile_media';

-- Active text was already debited by earlier releases. Reclassify that debit
-- as a refundable lock without changing the available balance a second time.
with inserted_locks as (
  insert into public.shell_locks (owner_address, lock_kind, lock_key, amount)
  select
    message.bitcoin_address,
    'message_text',
    message.id::text,
    greatest(coalesce(message.cost_shells, 0), 0)
  from public.messages as message
  where message.deleted_at is null
    and coalesce(message.cost_shells, 0) > 0
  on conflict (owner_address, lock_kind, lock_key) do nothing
  returning owner_address, amount
), totals as (
  select owner_address, sum(amount) as amount
  from inserted_locks
  group by owner_address
)
update public.user_balances as balance
set shells_spent_total = greatest(0, coalesce(balance.shells_spent_total, 0) - totals.amount)
from totals
where balance.bitcoin_address = totals.owner_address;

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
  account public.user_balances%rowtype;
  old_amount numeric := 0;
  new_amount bigint := 0;
  backing_room numeric := 0;
  old_key text;
  delta numeric;
  lock_type text;
  unlock_type text;
begin
  if p_media_kind not in ('avatar', 'cover') then raise exception 'Type de média invalide'; end if;
  if p_bytes < 0 or p_bytes > 5242880 then raise exception 'Taille d''image invalide'; end if;
  if p_pixels < 0 or p_pixels > 67108864 then raise exception 'Dimensions d''image invalides'; end if;
  if (p_bytes = 0 and (p_pixels <> 0 or p_public_url is not null or p_object_key is not null))
    or (p_bytes > 0 and (p_pixels = 0 or p_public_url is null or p_object_key is null)) then
    raise exception 'Média incomplet';
  end if;

  new_amount := case when p_bytes = 0 then 0 else ceil(p_bytes::numeric / 1024)::bigint end;

  select * into account
  from public.user_balances as balance
  where balance.bitcoin_address = p_bitcoin_address
  for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;

  select lock.amount into old_amount
  from public.shell_locks as lock
  where lock.owner_address = p_bitcoin_address
    and lock.lock_kind = 'profile_media'
    and lock.lock_key = p_media_kind
  for update;
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

  delta := new_amount - old_amount;
  if delta > account.shells_balance then raise exception 'INSUFFICIENT_SHELLS'; end if;

  update public.user_balances as balance
  set shells_balance = account.shells_balance - delta, last_sync = now()
  where balance.bitcoin_address = p_bitcoin_address;

  if new_amount = 0 then
    delete from public.shell_locks as lock
    where lock.owner_address = p_bitcoin_address
      and lock.lock_kind = 'profile_media'
      and lock.lock_key = p_media_kind;
  else
    insert into public.shell_locks (owner_address, lock_kind, lock_key, amount)
    values (p_bitcoin_address, 'profile_media', p_media_kind, new_amount)
    on conflict (owner_address, lock_kind, lock_key) do update
      set amount = excluded.amount, updated_at = now();
  end if;

  if p_media_kind = 'avatar' then
    update public.user_profiles as profile
    set
      avatar_url = p_public_url,
      avatar_object_key = p_object_key,
      avatar_pixels = p_pixels,
      avatar_bytes = p_bytes,
      updated_at = now()
    where profile.bitcoin_address = p_bitcoin_address;
  else
    update public.user_profiles as profile
    set
      cover_url = p_public_url,
      cover_object_key = p_object_key,
      cover_pixels = p_pixels,
      cover_bytes = p_bytes,
      updated_at = now()
    where profile.bitcoin_address = p_bitcoin_address;
  end if;

  if old_amount > 0 then
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_bitcoin_address, old_amount, unlock_type, clock_timestamp());
  end if;
  if new_amount > 0 then
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_bitcoin_address, -new_amount, lock_type, clock_timestamp());
  end if;

  return query select
    account.shells_balance - delta,
    new_amount,
    delta,
    old_key,
    coalesce(account.shells_spent_total, 0);
end;
$$;

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
  ) then
    raise exception 'Publication parente introuvable';
  end if;

  for media_item in select value from jsonb_array_elements(normalized_media)
  loop
    if jsonb_typeof(media_item) <> 'object'
      or not (media_item ? 'bytes')
      or (media_item ->> 'bytes') !~ '^[0-9]+$' then
      raise exception 'Taille de photo invalide';
    end if;
    byte_count := (media_item ->> 'bytes')::bigint;
    if byte_count < 1 or byte_count > 614400 then
      raise exception 'Taille de photo invalide';
    end if;
    media_cost := media_cost + ceil(byte_count::numeric / 1024);
  end loop;

  character_count := char_length(replace(coalesce(p_content, ''), E'\n', ''));
  text_cost := character_count;
  message_cost := text_cost + media_cost;

  select * into account
  from public.user_balances
  where bitcoin_address = p_bitcoin_address
  for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;
  if account.shells_balance < message_cost then raise exception 'INSUFFICIENT_SHELLS'; end if;

  insert into public.messages (
    bitcoin_address, content, char_count, cost_shells, parent_id, media, created_at
  ) values (
    p_bitcoin_address, coalesce(p_content, ''), character_count,
    message_cost, p_parent_id, normalized_media, now()
  ) returning * into inserted_message;

  update public.user_balances
  set shells_balance = account.shells_balance - message_cost, last_sync = now()
  where bitcoin_address = p_bitcoin_address;

  if text_cost > 0 then
    insert into public.shell_locks (owner_address, lock_kind, lock_key, amount)
    values (p_bitcoin_address, 'message_text', inserted_message.id::text, text_cost);
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_bitcoin_address, -text_cost, 'message_text_lock', now());
  end if;
  if media_cost > 0 then
    insert into public.shell_locks (owner_address, lock_kind, lock_key, amount)
    values (p_bitcoin_address, 'message_media', inserted_message.id::text, media_cost);
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_bitcoin_address, -media_cost, 'message_media_lock', now());
  end if;

  return query select
    to_jsonb(inserted_message), coalesce(account.btc_balance, 0),
    account.shells_balance - message_cost,
    coalesce(account.shells_spent_total, 0), message_cost;
end;
$$;

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
  locked_amount numeric := 0;
  backing_room numeric := 0;
  actual_refund numeric := 0;
begin
  select * into target_message
  from public.messages
  where id = p_target_message_id and deleted_at is null;
  if not found then raise exception 'Publication introuvable'; end if;

  original_target_id := coalesce(target_message.repost_of, target_message.id);
  if original_target_id <> target_message.id then
    select * into target_message
    from public.messages
    where id = original_target_id and deleted_at is null;
    if not found then raise exception 'Publication originale introuvable'; end if;
  end if;
  if target_message.bitcoin_address = p_bitcoin_address then
    raise exception 'Vous ne pouvez pas reposter votre propre publication';
  end if;

  select * into account
  from public.user_balances
  where bitcoin_address = p_bitcoin_address
  for update;
  if not found then raise exception 'Utilisateur non trouvé'; end if;

  if cleaned_quote is null then
    select * into existing_repost
    from public.messages
    where bitcoin_address = p_bitcoin_address
      and repost_of = original_target_id
      and repost_kind = 'simple'
      and deleted_at is null
    limit 1
    for update;

    if found then
      select lock.amount into locked_amount
      from public.shell_locks as lock
      where lock.owner_address = p_bitcoin_address
        and lock.lock_kind = 'message_text'
        and lock.lock_key = existing_repost.id::text
      for update;
      locked_amount := coalesce(locked_amount, 0);
      backing_room := greatest(
        0,
        round(coalesce(account.btc_balance, 0) * 100000000) - account.shells_balance
      );
      actual_refund := least(locked_amount, backing_room);

      update public.messages set deleted_at = now() where id = existing_repost.id;
      delete from public.shell_locks
      where owner_address = p_bitcoin_address
        and lock_kind in ('message_text', 'message_media')
        and lock_key = existing_repost.id::text;
      if actual_refund > 0 then
        update public.user_balances
        set shells_balance = account.shells_balance + actual_refund, last_sync = now()
        where bitcoin_address = p_bitcoin_address;
        insert into public.transactions (bitcoin_address, amount, type, created_at)
        values (p_bitcoin_address, actual_refund, 'message_text_unlock', now());
      end if;

      return query select
        false,
        (select count(*) from public.messages where repost_of = original_target_id and deleted_at is null),
        account.shells_balance + actual_refund,
        coalesce(account.shells_spent_total, 0),
        null::jsonb;
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

  if repost_cost > 0 then
    update public.user_balances
    set shells_balance = account.shells_balance - repost_cost, last_sync = now()
    where bitcoin_address = p_bitcoin_address;
    insert into public.shell_locks (owner_address, lock_kind, lock_key, amount)
    values (p_bitcoin_address, 'message_text', inserted_message.id::text, repost_cost);
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_bitcoin_address, -repost_cost, 'message_text_lock', now());
  end if;

  return query select
    true,
    (select count(*) from public.messages where repost_of = original_target_id and deleted_at is null),
    account.shells_balance - repost_cost,
    coalesce(account.shells_spent_total, 0),
    to_jsonb(inserted_message);
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
  text_amount numeric := 0;
  media_amount numeric := 0;
  backing_room numeric := 0;
  actual_text_refund numeric := 0;
  actual_media_refund numeric := 0;
begin
  select * into account
  from public.user_balances
  where bitcoin_address = p_bitcoin_address
  for update;
  if not found then raise exception 'Utilisateur introuvable'; end if;

  select * into target_message
  from public.messages
  where id = p_message_id and bitcoin_address = p_bitcoin_address
  for update;
  if not found then raise exception 'Publication introuvable'; end if;

  if target_message.deleted_at is not null then
    return query select
      account.shells_balance, 0::numeric, 0::numeric, '[]'::jsonb,
      coalesce(account.shells_spent_total, 0), true;
    return;
  end if;

  select
    coalesce(sum(locked.amount) filter (where locked.lock_kind = 'message_text'), 0),
    coalesce(sum(locked.amount) filter (where locked.lock_kind = 'message_media'), 0)
  into text_amount, media_amount
  from (
    select lock.lock_kind, lock.amount
    from public.shell_locks as lock
    where lock.owner_address = p_bitcoin_address
      and lock.lock_kind in ('message_text', 'message_media')
      and lock.lock_key = p_message_id::text
    for update
  ) as locked;

  backing_room := greatest(
    0,
    round(coalesce(account.btc_balance, 0) * 100000000) - account.shells_balance
  );
  actual_text_refund := least(text_amount, backing_room);
  actual_media_refund := least(media_amount, greatest(0, backing_room - actual_text_refund));

  update public.messages set deleted_at = now() where id = p_message_id;
  delete from public.shell_locks
  where owner_address = p_bitcoin_address
    and lock_kind in ('message_text', 'message_media')
    and lock_key = p_message_id::text;

  update public.user_balances
  set
    shells_balance = account.shells_balance + actual_text_refund + actual_media_refund,
    last_sync = now()
  where bitcoin_address = p_bitcoin_address;

  if actual_text_refund > 0 then
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_bitcoin_address, actual_text_refund, 'message_text_unlock', now());
  end if;
  if actual_media_refund > 0 then
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_bitcoin_address, actual_media_refund, 'message_media_unlock', now());
  end if;

  return query select
    account.shells_balance + actual_text_refund + actual_media_refund,
    actual_text_refund,
    actual_media_refund,
    coalesce(target_message.media, '[]'::jsonb),
    coalesce(account.shells_spent_total, 0),
    false;
end;
$$;

revoke all on function public.set_profile_media_size_lock(text, text, bigint, bigint, text, text)
  from public, anon, authenticated;
revoke execute on function public.set_profile_media_lock(text, text, bigint, text, text)
  from service_role;
revoke execute on function public.publish_message_with_cost(text, text, uuid)
  from service_role;
revoke execute on function public.publish_message_with_cost_idempotent(uuid, text, text, uuid)
  from service_role;
revoke all on function public.publish_message_with_media_cost(text, text, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.toggle_or_create_message_repost(text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.delete_message_and_release_locks(text, uuid)
  from public, anon, authenticated;

grant execute on function public.set_profile_media_size_lock(text, text, bigint, bigint, text, text)
  to service_role;
grant execute on function public.publish_message_with_media_cost(text, text, uuid, jsonb)
  to service_role;
grant execute on function public.toggle_or_create_message_repost(text, uuid, text)
  to service_role;
grant execute on function public.delete_message_and_release_locks(text, uuid)
  to service_role;
