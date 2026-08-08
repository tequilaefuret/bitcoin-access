-- Security fix: charge social reactions and update balances atomically.
-- The Edge Function authenticates the wallet before invoking this service-role-only RPC.

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
  reaction_cost constant numeric := 0.00000001;
  balance_before numeric;
  spent_before numeric;
  already_active boolean;
begin
  if p_action not in ('like', 'dislike', 'remove_like', 'remove_dislike') then
    raise exception 'Action inconnue';
  end if;

  if not exists (
    select 1 from public.messages as message
    where message.id = p_message_id and message.deleted_at is null
  ) then
    raise exception 'Message introuvable';
  end if;

  select
    coalesce(balance.shells_balance, 0),
    coalesce(balance.shells_spent_total, 0)
  into balance_before, spent_before
  from public.user_balances as balance
  where balance.bitcoin_address = p_bitcoin_address
  for update;

  if not found then
    raise exception 'Utilisateur introuvable';
  end if;

  if p_action = 'remove_like' then
    delete from public.message_likes
    where message_id = p_message_id and bitcoin_address = p_bitcoin_address;
    return query select false, balance_before, spent_before, 0::numeric;
    return;
  end if;

  if p_action = 'remove_dislike' then
    delete from public.message_dislikes
    where message_id = p_message_id and bitcoin_address = p_bitcoin_address;
    return query select false, balance_before, spent_before, 0::numeric;
    return;
  end if;

  if p_action = 'like' then
    select exists (
      select 1 from public.message_likes
      where message_id = p_message_id and bitcoin_address = p_bitcoin_address
    ) into already_active;
  else
    select exists (
      select 1 from public.message_dislikes
      where message_id = p_message_id and bitcoin_address = p_bitcoin_address
    ) into already_active;
  end if;

  -- Idempotent retries must never charge the same reaction twice.
  if already_active then
    return query select true, balance_before, spent_before, 0::numeric;
    return;
  end if;

  if balance_before < reaction_cost then
    raise exception 'Solde insuffisant';
  end if;

  if p_action = 'like' then
    delete from public.message_dislikes
    where message_id = p_message_id and bitcoin_address = p_bitcoin_address;
    insert into public.message_likes (message_id, bitcoin_address)
    values (p_message_id, p_bitcoin_address);
  else
    delete from public.message_likes
    where message_id = p_message_id and bitcoin_address = p_bitcoin_address;
    insert into public.message_dislikes (message_id, bitcoin_address)
    values (p_message_id, p_bitcoin_address);
  end if;

  update public.user_balances
  set
    shells_balance = balance_before - reaction_cost,
    shells_spent_total = spent_before + reaction_cost,
    last_sync = now()
  where bitcoin_address = p_bitcoin_address;

  insert into public.transactions (bitcoin_address, amount, type, created_at)
  values (
    p_bitcoin_address,
    -reaction_cost,
    case when p_action = 'like' then 'social_like' else 'social_dislike' end,
    now()
  );

  return query
  select true, balance_before - reaction_cost, spent_before + reaction_cost, reaction_cost;
end;
$$;

revoke all on function public.set_message_reaction_with_cost(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.set_message_reaction_with_cost(uuid, text, text)
  to service_role;

-- Security fix: game pricing is fixed on the server and the debit/history write
-- happen in the same database transaction.
create or replace function public.charge_game(p_bitcoin_address text)
returns table (
  bitcoin_address text,
  btc_balance numeric,
  shells_balance numeric,
  shells_spent_total numeric,
  last_sync timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  game_cost constant numeric := 0.000001;
  balance_before numeric;
  spent_before numeric;
  current_btc_balance numeric;
begin
  select
    coalesce(balance.shells_balance, 0),
    coalesce(balance.shells_spent_total, 0),
    coalesce(balance.btc_balance, 0)
  into balance_before, spent_before, current_btc_balance
  from public.user_balances as balance
  where balance.bitcoin_address = p_bitcoin_address
  for update;

  if not found then
    raise exception 'Utilisateur introuvable';
  end if;
  if balance_before < game_cost then
    raise exception 'Solde insuffisant';
  end if;

  update public.user_balances as balance
  set
    shells_balance = balance_before - game_cost,
    shells_spent_total = spent_before + game_cost,
    last_sync = now()
  where balance.bitcoin_address = p_bitcoin_address;

  insert into public.transactions (bitcoin_address, amount, type, game_score, created_at)
  values (p_bitcoin_address, -game_cost, 'game', null, now());

  return query select
    p_bitcoin_address,
    current_btc_balance,
    balance_before - game_cost,
    spent_before + game_cost,
    now();
end;
$$;

revoke all on function public.charge_game(text) from public, anon, authenticated;
grant execute on function public.charge_game(text) to service_role;

-- The browser only needs public read access to the canvas. All social and
-- accounting writes must pass through an authenticated Edge Function.
alter table public.messages enable row level security;
alter table public.transactions enable row level security;
alter table public.canvas_pixels enable row level security;
alter table public.message_likes enable row level security;
alter table public.message_dislikes enable row level security;
alter table public.follows enable row level security;

revoke all on table public.messages from anon, authenticated;
revoke all on table public.transactions from anon, authenticated;
revoke all on table public.message_likes from anon, authenticated;
revoke all on table public.message_dislikes from anon, authenticated;
revoke all on table public.follows from anon, authenticated;
revoke all on table public.canvas_pixels from anon, authenticated;
grant select on table public.canvas_pixels to anon, authenticated;

drop policy if exists canvas_pixels_public_read on public.canvas_pixels;
create policy canvas_pixels_public_read
on public.canvas_pixels
for select
to anon, authenticated
using (true);
