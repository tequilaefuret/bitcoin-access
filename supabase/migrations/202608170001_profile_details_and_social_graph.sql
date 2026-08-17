-- Rich public profiles and media references.
-- Binary image data stays in Cloudflare R2; only public delivery URLs are stored here.

alter table public.user_profiles
  add column if not exists location text,
  add column if not exists website_url text,
  add column if not exists avatar_url text,
  add column if not exists cover_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_profiles_bio_length_check') then
    alter table public.user_profiles
      add constraint user_profiles_bio_length_check
      check (bio is null or char_length(bio) <= 300) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'user_profiles_location_length_check') then
    alter table public.user_profiles
      add constraint user_profiles_location_length_check
      check (location is null or char_length(location) <= 80);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'user_profiles_website_url_check') then
    alter table public.user_profiles
      add constraint user_profiles_website_url_check
      check (website_url is null or (char_length(website_url) <= 2048 and website_url ~ '^https://'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'user_profiles_avatar_url_check') then
    alter table public.user_profiles
      add constraint user_profiles_avatar_url_check
      check (avatar_url is null or char_length(avatar_url) <= 2048);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'user_profiles_cover_url_check') then
    alter table public.user_profiles
      add constraint user_profiles_cover_url_check
      check (cover_url is null or char_length(cover_url) <= 2048);
  end if;
end $$;
