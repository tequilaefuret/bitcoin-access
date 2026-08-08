-- Close the remaining retry/concurrency gaps in publication, paid reads and
-- Bitcoin balance reconciliation. All external HTTP work remains outside the
-- database transaction; only the short ledger mutation is serialized here.

create table if not exists public.billing_idempotency_requests (
  bitcoin_address text not null,
  request_id uuid not null,
  operation text not null,
  request_payload jsonb not null,
  response_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (bitcoin_address, request_id)
);

create index if not exists billing_idempotency_requests_created_at_idx
  on public.billing_idempotency_requests (created_at);

alter table public.billing_idempotency_requests enable row level security;
revoke all on table public.billing_idempotency_requests
  from public, anon, authenticated;
grant select, insert, delete on table public.billing_idempotency_requests
  to service_role;

alter table public.user_balances
  add column if not exists btc_balance_observed_at timestamptz;

create or replace function public.publish_message_with_cost_idempotent(
  p_request_id uuid,
  p_bitcoin_address text,
  p_content text,
  p_parent_id uuid default null
)
returns table (
  created_message jsonb,
  btc_balance numeric,
  new_balance numeric,
  shells_spent_total numeric,
  cost numeric,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.user_balances%rowtype;
  existing_request public.billing_idempotency_requests%rowtype;
  charged record;
  payload jsonb;
  response jsonb;
begin
  if p_request_id is null then raise exception 'Identifiant de requête manquant'; end if;

  payload := jsonb_build_object(
    'content', p_content,
    'parent_id', p_parent_id
  );

  -- Serialize all mutations for this account, including concurrent retries.
  select * into account
  from public.user_balances
  where bitcoin_address = p_bitcoin_address
  for update;

  if not found then raise exception 'Utilisateur introuvable'; end if;

  select * into existing_request
  from public.billing_idempotency_requests
  where bitcoin_address = p_bitcoin_address
    and request_id = p_request_id;

  if found then
    if existing_request.operation <> 'publish_message'
      or existing_request.request_payload <> payload then
      raise exception 'Identifiant de requête déjà utilisé avec des paramètres différents';
    end if;

    response := existing_request.response_payload;
    return query select
      response -> 'created_message',
      coalesce(account.btc_balance, 0),
      coalesce(account.shells_balance, 0),
      coalesce(account.shells_spent_total, 0),
      (response ->> 'cost')::numeric,
      true;
    return;
  end if;

  select * into charged
  from public.publish_message_with_cost(
    p_bitcoin_address,
    p_content,
    p_parent_id
  );

  response := jsonb_build_object(
    'created_message', charged.created_message,
    'btc_balance', charged.btc_balance,
    'new_balance', charged.new_balance,
    'shells_spent_total', charged.shells_spent_total,
    'cost', charged.cost
  );

  insert into public.billing_idempotency_requests (
    bitcoin_address,
    request_id,
    operation,
    request_payload,
    response_payload
  ) values (
    p_bitcoin_address,
    p_request_id,
    'publish_message',
    payload,
    response
  );

  return query select
    charged.created_message,
    charged.btc_balance,
    charged.new_balance,
    charged.shells_spent_total,
    charged.cost,
    false;
end;
$$;

revoke all on function public.publish_message_with_cost_idempotent(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.publish_message_with_cost_idempotent(uuid, text, text, uuid)
  to service_role;

create or replace function public.charge_message_batch_idempotent(
  p_request_id uuid,
  p_bitcoin_address text,
  p_message_ids uuid[],
  p_request_context jsonb,
  p_messages_snapshot jsonb
)
returns table (
  charged_count integer,
  new_balance numeric,
  shells_spent_total numeric,
  cost numeric,
  messages_snapshot jsonb,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.user_balances%rowtype;
  existing_request public.billing_idempotency_requests%rowtype;
  charged record;
  normalized_ids uuid[];
  payload jsonb;
  response jsonb;
begin
  if p_request_id is null then raise exception 'Identifiant de requête manquant'; end if;

  select coalesce(array_agg(distinct message_id order by message_id), array[]::uuid[])
  into normalized_ids
  from unnest(coalesce(p_message_ids, array[]::uuid[])) as message_id;

  if p_request_context is null or jsonb_typeof(p_request_context) <> 'object' then
    raise exception 'Contexte de lecture invalide';
  end if;
  if p_messages_snapshot is null or jsonb_typeof(p_messages_snapshot) <> 'array' then
    raise exception 'Instantané de lecture invalide';
  end if;

  payload := p_request_context;

  select * into account
  from public.user_balances
  where bitcoin_address = p_bitcoin_address
  for update;

  if not found then raise exception 'Utilisateur introuvable'; end if;

  select * into existing_request
  from public.billing_idempotency_requests
  where bitcoin_address = p_bitcoin_address
    and request_id = p_request_id;

  if found then
    if existing_request.operation <> 'read_messages'
      or existing_request.request_payload <> payload then
      raise exception 'Identifiant de requête déjà utilisé avec des paramètres différents';
    end if;

    response := existing_request.response_payload;
    return query select
      (response ->> 'charged_count')::integer,
      coalesce(account.shells_balance, 0),
      coalesce(account.shells_spent_total, 0),
      (response ->> 'cost')::numeric,
      response -> 'messages_snapshot',
      true;
    return;
  end if;

  select * into charged
  from public.charge_message_batch(p_bitcoin_address, normalized_ids);

  response := jsonb_build_object(
    'charged_count', charged.charged_count,
    'new_balance', charged.new_balance,
    'shells_spent_total', charged.shells_spent_total,
    'cost', charged.cost,
    'message_ids', to_jsonb(normalized_ids),
    'messages_snapshot', p_messages_snapshot
  );

  insert into public.billing_idempotency_requests (
    bitcoin_address,
    request_id,
    operation,
    request_payload,
    response_payload
  ) values (
    p_bitcoin_address,
    p_request_id,
    'read_messages',
    payload,
    response
  );

  return query select
    charged.charged_count,
    charged.new_balance,
    charged.shells_spent_total,
    charged.cost,
    p_messages_snapshot,
    false;
end;
$$;

revoke all on function public.charge_message_batch_idempotent(uuid, text, uuid[], jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.charge_message_batch_idempotent(uuid, text, uuid[], jsonb, jsonb)
  to service_role;

create or replace function public.reconcile_bitcoin_balance_v2(
  p_bitcoin_address text,
  p_btc_balance numeric,
  p_observed_at timestamptz
)
returns table (
  bitcoin_address text,
  btc_balance numeric,
  shells_balance numeric,
  shells_spent_total numeric,
  last_sync timestamptz,
  balance_delta numeric,
  btc_balance_observed_at timestamptz,
  applied boolean
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
  if p_observed_at is null or p_observed_at > now() + interval '5 minutes' then
    raise exception 'Horodatage d''observation Bitcoin invalide';
  end if;

  observed_balance := round(p_btc_balance, 8);

  select * into account
  from public.user_balances as balance
  where balance.bitcoin_address = p_bitcoin_address
  for update;

  if not found then raise exception 'Utilisateur introuvable'; end if;

  -- A slower, older explorer response must never overwrite a newer one.
  if account.btc_balance_observed_at is not null
    and p_observed_at <= account.btc_balance_observed_at then
    return query select
      p_bitcoin_address,
      coalesce(account.btc_balance, 0),
      coalesce(account.shells_balance, 0),
      coalesce(account.shells_spent_total, 0),
      account.last_sync,
      0::numeric,
      account.btc_balance_observed_at,
      false;
    return;
  end if;

  delta := observed_balance - coalesce(account.btc_balance, 0);
  reconciled_shells := greatest(0, coalesce(account.shells_balance, 0) + delta);

  update public.user_balances as balance
  set
    btc_balance = observed_balance,
    shells_balance = reconciled_shells,
    last_sync = synchronized_at,
    btc_balance_observed_at = p_observed_at
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
    delta,
    p_observed_at,
    true;
end;
$$;

revoke all on function public.reconcile_bitcoin_balance_v2(text, numeric, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reconcile_bitcoin_balance_v2(text, numeric, timestamptz)
  to service_role;
