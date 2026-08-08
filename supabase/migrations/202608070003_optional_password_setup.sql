create table if not exists public.auth_account_preferences (
  bitcoin_address text primary key references public.user_balances(bitcoin_address) on delete cascade,
  password_prompt_skipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.auth_account_preferences enable row level security;

revoke all on table public.auth_account_preferences from public, anon, authenticated;
