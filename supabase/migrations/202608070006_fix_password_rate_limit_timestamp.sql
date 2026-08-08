create or replace function public.consume_password_rate_limit(
  p_scope_hash text,
  p_max_attempts integer,
  p_window_seconds integer,
  p_block_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  rate_limit public.auth_password_rate_limits%rowtype;
  v_now timestamptz := now();
begin
  if char_length(p_scope_hash) <> 64
    or p_max_attempts < 1
    or p_window_seconds < 1
    or p_block_seconds < 1 then
    return false;
  end if;

  select *
  into rate_limit
  from public.auth_password_rate_limits
  where scope_hash = p_scope_hash
  for update;

  if not found then
    insert into public.auth_password_rate_limits (scope_hash, attempts)
    values (p_scope_hash, 1);
    return true;
  end if;

  if rate_limit.blocked_until is not null and rate_limit.blocked_until > v_now then
    update public.auth_password_rate_limits
    set updated_at = v_now
    where scope_hash = p_scope_hash;
    return false;
  end if;

  if rate_limit.window_started_at <= v_now - make_interval(secs => p_window_seconds) then
    update public.auth_password_rate_limits
    set
      attempts = 1,
      window_started_at = v_now,
      blocked_until = null,
      updated_at = v_now
    where scope_hash = p_scope_hash;
    return true;
  end if;

  rate_limit.attempts := rate_limit.attempts + 1;
  update public.auth_password_rate_limits
  set
    attempts = rate_limit.attempts,
    blocked_until = case
      when rate_limit.attempts > p_max_attempts
        then v_now + make_interval(secs => p_block_seconds)
      else null
    end,
    updated_at = v_now
  where scope_hash = p_scope_hash;

  return rate_limit.attempts <= p_max_attempts;
end;
$$;

revoke all on function public.consume_password_rate_limit(text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_password_rate_limit(text, integer, integer, integer)
  to service_role;
