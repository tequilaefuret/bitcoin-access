-- Attach up to three small, immutable R2 images to a root publication. The
-- database stores only validated metadata; image bytes stay in Cloudflare R2.

alter table public.messages
  add column if not exists media jsonb not null default '[]'::jsonb;

alter table public.messages
  drop constraint if exists messages_media_shape_check;

alter table public.messages
  add constraint messages_media_shape_check check (
    jsonb_typeof(media) = 'array'
    and jsonb_array_length(media) between 0 and 3
  );

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
  character_count integer;
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
    select 1
    from public.messages
    where id = p_parent_id and deleted_at is null
  ) then
    raise exception 'Publication parente introuvable';
  end if;

  character_count := char_length(replace(coalesce(p_content, ''), E'\n', ''));
  message_cost := character_count;

  select * into account
  from public.user_balances
  where bitcoin_address = p_bitcoin_address
  for update;

  if not found then raise exception 'Utilisateur introuvable'; end if;
  if account.shells_balance < message_cost then raise exception 'INSUFFICIENT_SHELLS'; end if;

  insert into public.messages (
    bitcoin_address,
    content,
    char_count,
    cost_shells,
    parent_id,
    media,
    created_at
  ) values (
    p_bitcoin_address,
    coalesce(p_content, ''),
    character_count,
    message_cost,
    p_parent_id,
    normalized_media,
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

revoke all on function public.publish_message_with_media_cost(text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_message_with_media_cost(text, text, uuid, jsonb)
  to service_role;

create or replace function public.publish_message_with_media_cost_idempotent(
  p_request_id uuid,
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
  normalized_media jsonb := coalesce(p_media, '[]'::jsonb);
  payload jsonb;
  response jsonb;
begin
  if p_request_id is null then raise exception 'Identifiant de requête manquant'; end if;

  payload := jsonb_build_object(
    'content', coalesce(p_content, ''),
    'parent_id', p_parent_id,
    'media', normalized_media
  );

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
  from public.publish_message_with_media_cost(
    p_bitcoin_address,
    coalesce(p_content, ''),
    p_parent_id,
    normalized_media
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

revoke all on function public.publish_message_with_media_cost_idempotent(uuid, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_message_with_media_cost_idempotent(uuid, text, text, uuid, jsonb)
  to service_role;
