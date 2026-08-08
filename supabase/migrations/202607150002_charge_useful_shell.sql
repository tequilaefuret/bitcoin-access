-- Toggle Useful and charge its cost in one database transaction.
-- Removing an existing Useful signal is free.

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
  useful_cost constant numeric := 0.00000001;
  message_author text;
  balance_before numeric;
  spent_before numeric;
begin
  select m.bitcoin_address
  into message_author
  from public.messages as m
  where m.id = p_message_id
    and m.deleted_at is null;

  if not found then
    raise exception 'Message introuvable';
  end if;

  if message_author = p_bitcoin_address then
    raise exception 'Vous ne pouvez pas marquer votre propre publication comme utile';
  end if;

  -- Serialise paid interactions for this wallet before checking the vote.
  select
    coalesce(ub.shells_balance, 0),
    coalesce(ub.shells_spent_total, 0)
  into balance_before, spent_before
  from public.user_balances as ub
  where ub.bitcoin_address = p_bitcoin_address
  for update;

  if not found then
    raise exception 'Utilisateur introuvable';
  end if;

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
    select
      false,
      coalesce(m.useful_count, 0),
      balance_before,
      spent_before,
      0::numeric
    from public.messages as m
    where m.id = p_message_id;

    return;
  end if;

  if balance_before < useful_cost then
    raise exception 'Solde insuffisant. Requis: % shells, Disponible: % shells',
      to_char(useful_cost, 'FM0.00000000'),
      to_char(balance_before, 'FM0.00000000');
  end if;

  update public.user_balances as ub
  set
    shells_balance = balance_before - useful_cost,
    shells_spent_total = spent_before + useful_cost,
    last_sync = now()
  where ub.bitcoin_address = p_bitcoin_address;

  insert into public.message_useful_votes (message_id, bitcoin_address)
  values (p_message_id, p_bitcoin_address);

  insert into public.transactions (bitcoin_address, amount, type, created_at)
  values (p_bitcoin_address, -useful_cost, 'social_useful', now());

  return query
  select
    true,
    coalesce(m.useful_count, 0),
    balance_before - useful_cost,
    spent_before + useful_cost,
    useful_cost
  from public.messages as m
  where m.id = p_message_id;
end;
$$;

revoke all on function public.toggle_message_useful_with_cost(uuid, text)
  from public, anon, authenticated;
grant execute on function public.toggle_message_useful_with_cost(uuid, text)
  to service_role;
