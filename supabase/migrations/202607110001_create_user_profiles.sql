create table if not exists public.user_profiles (
  bitcoin_address text primary key references public.user_balances(bitcoin_address) on delete cascade,
  display_name text not null,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_display_name_length_check check (char_length(btrim(display_name)) between 3 and 50)
);

create unique index if not exists user_profiles_display_name_lower_unique
  on public.user_profiles (lower(display_name));
