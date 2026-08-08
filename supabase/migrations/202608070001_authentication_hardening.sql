create extension if not exists pgcrypto;

alter table public.user_balances
  add column if not exists ownership_verified_at timestamptz,
  add column if not exists ownership_address_type text,
  add column if not exists ownership_proof_method text;

alter table public.user_balances
  alter column signature_proof drop not null;

-- Preserve non-sensitive verification metadata before removing reusable proofs.
update public.user_balances
set
  ownership_verified_at = coalesce(
    ownership_verified_at,
    nullif(signature_proof ->> 'verified_at', '')::timestamptz,
    case
      when coalesce((signature_proof ->> 'verified')::boolean, false) then created_at
      else null
    end
  ),
  ownership_address_type = coalesce(
    ownership_address_type,
    nullif(signature_proof ->> 'addressType', '')
  ),
  ownership_proof_method = coalesce(
    ownership_proof_method,
    nullif(signature_proof ->> 'methodId', '')
  ),
  signature_proof = null
where signature_proof is not null;

create table if not exists public.auth_challenges (
  request_id uuid primary key,
  bitcoin_address text not null,
  challenge_hash text not null,
  domain text not null,
  purpose text not null default 'login',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint auth_challenges_hash_length check (char_length(challenge_hash) = 64),
  constraint auth_challenges_expiration check (expires_at > created_at)
);

create index if not exists auth_challenges_expiry_idx
  on public.auth_challenges (expires_at)
  where used_at is null;

create table if not exists public.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null default gen_random_uuid(),
  bitcoin_address text not null references public.user_balances(bitcoin_address) on delete cascade,
  refresh_token_hash text not null unique,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid references public.auth_sessions(id) on delete set null,
  constraint auth_sessions_hash_length check (char_length(refresh_token_hash) = 64),
  constraint auth_sessions_expiration check (expires_at > created_at)
);

create index if not exists auth_sessions_active_address_idx
  on public.auth_sessions (bitcoin_address, expires_at)
  where revoked_at is null;

create index if not exists auth_sessions_active_family_idx
  on public.auth_sessions (family_id, expires_at)
  where revoked_at is null;

alter table public.auth_challenges enable row level security;
alter table public.auth_sessions enable row level security;
alter table public.user_balances enable row level security;
alter table public.user_profiles enable row level security;

revoke all on table public.auth_challenges from public, anon, authenticated;
revoke all on table public.auth_sessions from public, anon, authenticated;
revoke all on table public.user_balances from anon, authenticated;
revoke all on table public.user_profiles from anon, authenticated;

create or replace function public.consume_auth_challenge(
  p_request_id uuid,
  p_bitcoin_address text,
  p_challenge_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
begin
  update public.auth_challenges
  set used_at = now()
  where request_id = p_request_id
    and bitcoin_address = p_bitcoin_address
    and challenge_hash = p_challenge_hash
    and used_at is null
    and expires_at > now();

  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

create or replace function public.rotate_auth_session(
  p_current_token_hash text,
  p_new_token_hash text,
  p_new_expires_at timestamptz,
  p_user_agent text default null
)
returns table(bitcoin_address text, session_id uuid)
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
    expires_at
  ) values (
    current_session.family_id,
    current_session.bitcoin_address,
    p_new_token_hash,
    left(p_user_agent, 500),
    p_new_expires_at
  )
  returning id into next_session_id;

  update public.auth_sessions
  set
    revoked_at = now(),
    last_seen_at = now(),
    replaced_by = next_session_id
  where id = current_session.id;

  return query
  select current_session.bitcoin_address, current_session.family_id;
end;
$$;

revoke all on function public.consume_auth_challenge(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.rotate_auth_session(text, text, timestamptz, text)
  from public, anon, authenticated;

grant execute on function public.consume_auth_challenge(uuid, text, text) to service_role;
grant execute on function public.rotate_auth_session(text, text, timestamptz, text) to service_role;
