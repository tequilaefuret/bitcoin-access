create or replace function public.get_password_login_credential(p_identifier text)
returns table(
  bitcoin_address text,
  password_hash text,
  password_salt text,
  iterations integer
)
language sql
security definer
set search_path = ''
as $$
  select
    credentials.bitcoin_address,
    credentials.password_hash,
    credentials.password_salt,
    credentials.iterations
  from public.auth_password_credentials as credentials
  left join public.user_profiles as profile
    on profile.bitcoin_address = credentials.bitcoin_address
  where lower(credentials.bitcoin_address) = lower(btrim(p_identifier))
    or lower(profile.display_name) = lower(btrim(p_identifier))
  order by case
    when lower(credentials.bitcoin_address) = lower(btrim(p_identifier)) then 1
    else 2
  end
  limit 1;
$$;

revoke all on function public.get_password_login_credential(text)
  from public, anon, authenticated;
grant execute on function public.get_password_login_credential(text)
  to service_role;
