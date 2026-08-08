create table if not exists public.auth_password_credentials (
  bitcoin_address text primary key references public.user_balances(bitcoin_address) on delete cascade,
  password_hash text not null,
  password_salt text not null,
  algorithm text not null default 'pbkdf2-sha256',
  iterations integer not null default 600000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  password_changed_at timestamptz not null default now(),
  constraint auth_password_hash_length check (char_length(password_hash) = 64),
  constraint auth_password_salt_length check (char_length(password_salt) between 22 and 128),
  constraint auth_password_algorithm check (algorithm = 'pbkdf2-sha256'),
  constraint auth_password_iterations check (iterations between 100000 and 2000000)
);

create table if not exists public.auth_password_rate_limits (
  scope_hash text primary key,
  attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  constraint auth_password_rate_scope_hash_length check (char_length(scope_hash) = 64),
  constraint auth_password_rate_attempts check (attempts >= 0)
);

create index if not exists auth_password_rate_limits_cleanup_idx
  on public.auth_password_rate_limits (updated_at);

alter table public.auth_password_credentials enable row level security;
alter table public.auth_password_rate_limits enable row level security;

revoke all on table public.auth_password_credentials from public, anon, authenticated;
revoke all on table public.auth_password_rate_limits from public, anon, authenticated;

alter table public.auth_sessions
  add column if not exists authentication_method text not null default 'wallet';

alter table public.auth_sessions
  drop constraint if exists auth_sessions_authentication_method_check;

alter table public.auth_sessions
  add constraint auth_sessions_authentication_method_check
  check (authentication_method in ('wallet', 'password', 'passkey'));

create or replace function public.resolve_password_login_identifier(p_identifier text)
returns text
language sql
security definer
set search_path = ''
as $$
  select candidate.bitcoin_address
  from (
    select credentials.bitcoin_address, 1 as priority
    from public.auth_password_credentials as credentials
    where lower(credentials.bitcoin_address) = lower(btrim(p_identifier))

    union all

    select credentials.bitcoin_address, 2 as priority
    from public.auth_password_credentials as credentials
    join public.user_profiles as profiles
      on profiles.bitcoin_address = credentials.bitcoin_address
    where lower(profiles.display_name) = lower(btrim(p_identifier))
  ) as candidate
  order by candidate.priority
  limit 1;
$$;

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
  current_time timestamptz := now();
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

  if rate_limit.blocked_until is not null and rate_limit.blocked_until > current_time then
    update public.auth_password_rate_limits
    set updated_at = current_time
    where scope_hash = p_scope_hash;
    return false;
  end if;

  if rate_limit.window_started_at <= current_time - make_interval(secs => p_window_seconds) then
    update public.auth_password_rate_limits
    set
      attempts = 1,
      window_started_at = current_time,
      blocked_until = null,
      updated_at = current_time
    where scope_hash = p_scope_hash;
    return true;
  end if;

  rate_limit.attempts := rate_limit.attempts + 1;
  update public.auth_password_rate_limits
  set
    attempts = rate_limit.attempts,
    blocked_until = case
      when rate_limit.attempts > p_max_attempts
        then current_time + make_interval(secs => p_block_seconds)
      else null
    end,
    updated_at = current_time
  where scope_hash = p_scope_hash;

  return rate_limit.attempts <= p_max_attempts;
end;
$$;

create or replace function public.clear_password_rate_limit(p_scope_hash text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.auth_password_rate_limits where scope_hash = p_scope_hash;
$$;

revoke all on function public.resolve_password_login_identifier(text)
  from public, anon, authenticated;
revoke all on function public.consume_password_rate_limit(text, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.clear_password_rate_limit(text)
  from public, anon, authenticated;

grant execute on function public.resolve_password_login_identifier(text) to service_role;
grant execute on function public.consume_password_rate_limit(text, integer, integer, integer) to service_role;
grant execute on function public.clear_password_rate_limit(text) to service_role;

drop function if exists public.rotate_auth_session(text, text, timestamptz, text);

create function public.rotate_auth_session(
  p_current_token_hash text,
  p_new_token_hash text,
  p_new_expires_at timestamptz,
  p_user_agent text default null
)
returns table(bitcoin_address text, session_id uuid, authentication_method text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_session public.auth_sessions%rowtype;
  next_session_id uuid;
begin
  select *
  into current_session
  from public.auth_sessions
  where refresh_token_hash = p_current_token_hash
    and revoked_at is null
    and expires_at > now()
  for update;

  if not found then
    return;
  end if;

  insert into public.auth_sessions (
    family_id,
    bitcoin_address,
    refresh_token_hash,
    user_agent,
    expires_at,
    authentication_method
  ) values (
    current_session.family_id,
    current_session.bitcoin_address,
    p_new_token_hash,
    left(p_user_agent, 500),
    p_new_expires_at,
    current_session.authentication_method
  )
  returning id into next_session_id;

  update public.auth_sessions
  set
    revoked_at = now(),
    last_seen_at = now(),
    replaced_by = next_session_id
  where id = current_session.id;

  return query
  select
    current_session.bitcoin_address,
    current_session.family_id,
    current_session.authentication_method;
end;
$$;

revoke all on function public.rotate_auth_session(text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.rotate_auth_session(text, text, timestamptz, text) to service_role;
