-- Rename the network currency from wbtc to shells.
-- Existing balances are preserved; already-renamed databases are left unchanged.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_balances'
      and column_name = 'wbtc_balance'
  ) then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'user_balances'
        and column_name = 'shells_balance'
    ) then
      raise exception 'user_balances contains both wbtc_balance and shells_balance';
    end if;

    execute 'alter table public.user_balances rename column wbtc_balance to shells_balance';
  elsif not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_balances'
      and column_name = 'shells_balance'
  ) then
    raise exception 'user_balances contains neither wbtc_balance nor shells_balance';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_balances'
      and column_name = 'wbtc_spent_total'
  ) then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'user_balances'
        and column_name = 'shells_spent_total'
    ) then
      raise exception 'user_balances contains both wbtc_spent_total and shells_spent_total';
    end if;

    execute 'alter table public.user_balances rename column wbtc_spent_total to shells_spent_total';
  elsif not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_balances'
      and column_name = 'shells_spent_total'
  ) then
    raise exception 'user_balances contains neither wbtc_spent_total nor shells_spent_total';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'messages'
      and column_name = 'cost_wbtc'
  ) then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'messages'
        and column_name = 'cost_shells'
    ) then
      raise exception 'messages contains both cost_wbtc and cost_shells';
    end if;

    execute 'alter table public.messages rename column cost_wbtc to cost_shells';
  elsif not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'messages'
      and column_name = 'cost_shells'
  ) then
    raise exception 'messages contains neither cost_wbtc nor cost_shells';
  end if;
end;
$$;
