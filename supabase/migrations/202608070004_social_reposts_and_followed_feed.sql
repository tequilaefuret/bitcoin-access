alter table public.messages
  add column if not exists repost_kind text;

update public.messages
set repost_kind = case
  when btrim(coalesce(content, '')) = '' then 'simple'
  else 'quote'
end
where repost_of is not null
  and repost_kind is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_repost_kind_check'
  ) then
    alter table public.messages
      add constraint messages_repost_kind_check check (
        (repost_of is null and repost_kind is null)
        or (repost_of is not null and repost_kind in ('simple', 'quote'))
      );
  end if;
end $$;

create unique index if not exists messages_simple_repost_unique
  on public.messages (bitcoin_address, repost_of)
  where repost_of is not null
    and repost_kind = 'simple'
    and deleted_at is null;

create index if not exists messages_followed_feed_idx
  on public.messages (bitcoin_address, created_at desc)
  where deleted_at is null and parent_id is null;

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
  existing_repost_id uuid;
  original_target_id uuid;
  cleaned_quote text := nullif(btrim(coalesce(p_quote_content, '')), '');
  quote_character_count integer := 0;
  quote_cost numeric := 0;
begin
  select *
  into target_message
  from public.messages
  where id = p_target_message_id
    and deleted_at is null;

  if not found then raise exception 'Publication introuvable'; end if;

  original_target_id := coalesce(target_message.repost_of, target_message.id);
  if original_target_id <> target_message.id then
    select *
    into target_message
    from public.messages
    where id = original_target_id
      and deleted_at is null;
    if not found then raise exception 'Publication originale introuvable'; end if;
  end if;

  if target_message.bitcoin_address = p_bitcoin_address then
    raise exception 'Vous ne pouvez pas reposter votre propre publication';
  end if;

  select *
  into account
  from public.user_balances
  where bitcoin_address = p_bitcoin_address
  for update;

  if not found then raise exception 'Utilisateur non trouvé'; end if;

  if cleaned_quote is null then
    select id
    into existing_repost_id
    from public.messages
    where bitcoin_address = p_bitcoin_address
      and repost_of = original_target_id
      and repost_kind = 'simple'
      and deleted_at is null
    limit 1;

    if existing_repost_id is not null then
      delete from public.messages where id = existing_repost_id;
      return query
      select
        false,
        (select count(*) from public.messages where repost_of = original_target_id and deleted_at is null),
        account.shells_balance,
        coalesce(account.shells_spent_total, 0),
        null::jsonb;
      return;
    end if;
  else
    if char_length(cleaned_quote) > 1000 then
      raise exception 'La citation ne peut pas dépasser 1000 caractères';
    end if;
    quote_character_count := char_length(replace(cleaned_quote, E'\n', ''));
    quote_cost := quote_character_count * 0.00000001;
    if account.shells_balance < quote_cost then
      raise exception 'Solde insuffisant pour publier cette citation';
    end if;
  end if;

  insert into public.messages (
    bitcoin_address, content, char_count, cost_shells, created_at, repost_of, repost_kind
  ) values (
    p_bitcoin_address,
    coalesce(cleaned_quote, ''),
    quote_character_count,
    quote_cost,
    now(),
    original_target_id,
    case when cleaned_quote is null then 'simple' else 'quote' end
  )
  returning * into inserted_message;

  if quote_cost > 0 then
    update public.user_balances as balances
    set
      shells_balance = balances.shells_balance - quote_cost,
      shells_spent_total = coalesce(balances.shells_spent_total, 0) + quote_cost,
      last_sync = now()
    where balances.bitcoin_address = p_bitcoin_address
    returning * into account;

    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_bitcoin_address, -quote_cost, 'message', now());
  end if;

  return query
  select
    true,
    (select count(*) from public.messages where repost_of = original_target_id and deleted_at is null),
    account.shells_balance,
    coalesce(account.shells_spent_total, 0),
    to_jsonb(inserted_message);
end;
$$;

revoke all on function public.toggle_or_create_message_repost(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.toggle_or_create_message_repost(text, uuid, text)
  to service_role;
