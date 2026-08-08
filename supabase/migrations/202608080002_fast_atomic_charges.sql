-- Fast billing path: user actions only consult the cached internal ledger.
-- No blockchain or third-party API call is made by these functions.

create or replace function public.publish_message_with_cost(
  p_bitcoin_address text,
  p_content text,
  p_parent_id uuid default null
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
  character_count integer;
  message_cost numeric;
begin
  if p_content is null or btrim(p_content) = '' then
    raise exception 'Le message ne peut pas être vide';
  end if;
  if char_length(p_content) > 1000 then
    raise exception 'Le message ne peut pas dépasser 1000 caractères';
  end if;
  if p_parent_id is not null and not exists (
    select 1 from public.messages
    where id = p_parent_id and deleted_at is null
  ) then
    raise exception 'Publication parente introuvable';
  end if;

  character_count := char_length(replace(p_content, E'\n', ''));
  message_cost := character_count * 0.00000001;

  -- This row lock is local to PostgreSQL and normally lasts only milliseconds.
  select *
  into account
  from public.user_balances
  where bitcoin_address = p_bitcoin_address
  for update;

  if not found then raise exception 'Utilisateur introuvable'; end if;
  if account.shells_balance < message_cost then
    raise exception 'Solde insuffisant';
  end if;

  insert into public.messages (
    bitcoin_address,
    content,
    char_count,
    cost_shells,
    parent_id,
    created_at
  ) values (
    p_bitcoin_address,
    p_content,
    character_count,
    message_cost,
    p_parent_id,
    now()
  )
  returning * into inserted_message;

  update public.user_balances
  set
    shells_balance = account.shells_balance - message_cost,
    shells_spent_total = coalesce(account.shells_spent_total, 0) + message_cost,
    last_sync = now()
  where bitcoin_address = p_bitcoin_address;

  if message_cost > 0 then
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_bitcoin_address, -message_cost, 'message', now());
  end if;

  return query select
    to_jsonb(inserted_message),
    coalesce(account.btc_balance, 0),
    account.shells_balance - message_cost,
    coalesce(account.shells_spent_total, 0) + message_cost,
    message_cost;
end;
$$;

revoke all on function public.publish_message_with_cost(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.publish_message_with_cost(text, text, uuid)
  to service_role;

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
  item_count integer;
  batch_cost numeric;
begin
  select count(distinct message_id)::integer
  into item_count
  from unnest(coalesce(p_message_ids, array[]::uuid[])) as message_id;

  if item_count > 20 then
    raise exception 'Un lot de lecture ne peut pas dépasser 20 publications';
  end if;

  batch_cost := item_count * 0.00000001;

  select *
  into account
  from public.user_balances
  where bitcoin_address = p_bitcoin_address
  for update;

  if not found then raise exception 'Utilisateur introuvable'; end if;
  if account.shells_balance < batch_cost then
    raise exception 'Solde insuffisant';
  end if;

  if batch_cost > 0 then
    update public.user_balances
    set
      shells_balance = account.shells_balance - batch_cost,
      shells_spent_total = coalesce(account.shells_spent_total, 0) + batch_cost,
      last_sync = now()
    where bitcoin_address = p_bitcoin_address;

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
grant execute on function public.charge_message_batch(text, uuid[])
  to service_role;

-- Apply an externally observed Bitcoin balance without racing a simultaneous
-- user debit. The external fetch happens before this short local transaction.
create or replace function public.reconcile_bitcoin_balance(
  p_bitcoin_address text,
  p_btc_balance numeric
)
returns table (
  bitcoin_address text,
  btc_balance numeric,
  shells_balance numeric,
  shells_spent_total numeric,
  last_sync timestamptz,
  balance_delta numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.user_balances%rowtype;
  observed_balance numeric;
  delta numeric;
  reconciled_shells numeric;
  synchronized_at timestamptz := now();
begin
  if p_btc_balance is null or p_btc_balance < 0 then
    raise exception 'Solde Bitcoin observé invalide';
  end if;
  observed_balance := round(p_btc_balance, 8);

  select *
  into account
  from public.user_balances as balance
  where balance.bitcoin_address = p_bitcoin_address
  for update;

  if not found then raise exception 'Utilisateur introuvable'; end if;

  delta := observed_balance - coalesce(account.btc_balance, 0);
  reconciled_shells := greatest(0, coalesce(account.shells_balance, 0) + delta);

  update public.user_balances as balance
  set
    btc_balance = observed_balance,
    shells_balance = reconciled_shells,
    last_sync = synchronized_at
  where balance.bitcoin_address = p_bitcoin_address;

  if delta <> 0 then
    insert into public.transactions (bitcoin_address, amount, type, created_at)
    values (p_bitcoin_address, delta, 'sync', synchronized_at);
  end if;

  return query select
    p_bitcoin_address,
    observed_balance,
    reconciled_shells,
    coalesce(account.shells_spent_total, 0),
    synchronized_at,
    delta;
end;
$$;

revoke all on function public.reconcile_bitcoin_balance(text, numeric)
  from public, anon, authenticated;
grant execute on function public.reconcile_bitcoin_balance(text, numeric)
  to service_role;
