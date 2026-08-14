-- Editorial safety foundation.
--
-- User choices remain private. Reports contain no free-form reason and expose
-- only aggregate counts. Automated manipulation detection only downranks
-- suspicious engagement; it never deletes or hides content by itself.

create table if not exists public.editorial_safety_settings (
  singleton boolean primary key default true,
  burst_window_minutes integer not null default 15,
  burst_min_actors integer not null default 6,
  new_account_days integer not null default 7,
  new_account_ratio_threshold double precision not null default 0.67,
  updated_at timestamptz not null default now(),
  constraint editorial_safety_settings_singleton_check check (singleton),
  constraint editorial_safety_settings_window_check check (burst_window_minutes between 5 and 60),
  constraint editorial_safety_settings_actor_check check (burst_min_actors between 3 and 100),
  constraint editorial_safety_settings_account_age_check check (new_account_days between 1 and 30),
  constraint editorial_safety_settings_ratio_check check (
    new_account_ratio_threshold between 0.5 and 1.0
  )
);

insert into public.editorial_safety_settings (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.editorial_author_preferences (
  reader_address text not null
    references public.user_balances(bitcoin_address) on delete cascade,
  target_address text not null
    references public.user_balances(bitcoin_address) on delete cascade,
  preference text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (reader_address, target_address),
  constraint editorial_author_preferences_no_self_check check (reader_address <> target_address),
  constraint editorial_author_preferences_kind_check check (
    preference in ('reduce', 'mute', 'block')
  )
);

create index if not exists editorial_author_preferences_target_block_idx
  on public.editorial_author_preferences (target_address, reader_address)
  where preference = 'block';

alter table public.messages
  add column if not exists report_count integer not null default 0;

alter table public.user_profiles
  add column if not exists report_count integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_report_count_check'
  ) then
    alter table public.messages
      add constraint messages_report_count_check check (report_count >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'user_profiles_report_count_check'
  ) then
    alter table public.user_profiles
      add constraint user_profiles_report_count_check check (report_count >= 0);
  end if;
end $$;

create table if not exists public.editorial_reports (
  id bigint generated always as identity primary key,
  reporter_address text not null
    references public.user_balances(bitcoin_address) on delete cascade,
  target_kind text not null,
  message_id uuid references public.messages(id) on delete cascade,
  profile_address text references public.user_profiles(bitcoin_address) on delete cascade,
  created_at timestamptz not null default now(),
  constraint editorial_reports_kind_check check (target_kind in ('message', 'profile')),
  constraint editorial_reports_target_check check (
    (target_kind = 'message' and message_id is not null and profile_address is null)
    or (target_kind = 'profile' and message_id is null and profile_address is not null)
  )
);

create unique index if not exists editorial_reports_unique_message_idx
  on public.editorial_reports (reporter_address, message_id)
  where target_kind = 'message';

create unique index if not exists editorial_reports_unique_profile_idx
  on public.editorial_reports (reporter_address, profile_address)
  where target_kind = 'profile';

create index if not exists editorial_reports_message_count_idx
  on public.editorial_reports (message_id)
  where target_kind = 'message';

create index if not exists editorial_reports_profile_count_idx
  on public.editorial_reports (profile_address)
  where target_kind = 'profile';

create table if not exists public.editorial_message_risk (
  message_id uuid primary key references public.messages(id) on delete cascade,
  risk_score double precision not null default 0,
  reason_codes text[] not null default array[]::text[],
  engagement_count integer not null default 0,
  unique_actor_count integer not null default 0,
  checked_at timestamptz not null default now(),
  constraint editorial_message_risk_score_check check (risk_score between 0 and 1),
  constraint editorial_message_risk_counts_check check (
    engagement_count >= 0 and unique_actor_count >= 0
  )
);

create index if not exists editorial_message_risk_score_idx
  on public.editorial_message_risk (risk_score desc, checked_at desc)
  where risk_score > 0;

alter table public.editorial_safety_settings enable row level security;
alter table public.editorial_author_preferences enable row level security;
alter table public.editorial_reports enable row level security;
alter table public.editorial_message_risk enable row level security;

revoke all on table public.editorial_safety_settings from public, anon, authenticated;
revoke all on table public.editorial_author_preferences from public, anon, authenticated;
revoke all on table public.editorial_reports from public, anon, authenticated;
revoke all on table public.editorial_message_risk from public, anon, authenticated;

grant select, update on table public.editorial_safety_settings to service_role;
grant select, insert, update, delete on table public.editorial_author_preferences to service_role;
grant select, insert on table public.editorial_reports to service_role;
grant select, insert, update, delete on table public.editorial_message_risk to service_role;

create or replace function public.set_editorial_author_preference(
  p_reader_address text,
  p_target_address text,
  p_preference text
)
returns table (preference text, active boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_reader_address is null or p_target_address is null then
    raise exception 'Contexte éditorial incomplet';
  end if;
  if p_reader_address = p_target_address then
    raise exception 'Vous ne pouvez pas appliquer ce choix à votre propre compte';
  end if;
  if not exists (
    select 1 from public.user_balances where bitcoin_address = p_target_address
  ) then
    raise exception 'Compte introuvable';
  end if;

  if p_preference is null or p_preference = 'none' then
    delete from public.editorial_author_preferences
    where reader_address = p_reader_address and target_address = p_target_address;
    return query select 'none'::text, false;
    return;
  end if;

  if p_preference not in ('reduce', 'mute', 'block') then
    raise exception 'Choix éditorial invalide';
  end if;

  insert into public.editorial_author_preferences (
    reader_address,
    target_address,
    preference,
    created_at,
    updated_at
  ) values (
    p_reader_address,
    p_target_address,
    p_preference,
    now(),
    now()
  )
  on conflict (reader_address, target_address) do update set
    preference = excluded.preference,
    updated_at = now();

  if p_preference = 'block' then
    delete from public.follows
    where (follower_address = p_reader_address and following_address = p_target_address)
       or (follower_address = p_target_address and following_address = p_reader_address);
  end if;

  return query select p_preference, true;
end;
$$;

create or replace function public.record_editorial_report(
  p_reporter_address text,
  p_target_kind text,
  p_message_id uuid default null,
  p_profile_address text default null
)
returns table (created boolean, report_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer := 0;
  target_author text;
  current_count integer := 0;
begin
  if p_target_kind = 'message' then
    select message.bitcoin_address into target_author
    from public.messages as message
    where message.id = p_message_id and message.deleted_at is null;

    if target_author is null then raise exception 'Publication introuvable'; end if;
    if target_author = p_reporter_address then
      raise exception 'Vous ne pouvez pas signaler votre propre publication';
    end if;

    insert into public.editorial_reports (
      reporter_address, target_kind, message_id
    ) values (
      p_reporter_address, 'message', p_message_id
    ) on conflict do nothing;
    get diagnostics inserted_count = row_count;

    if inserted_count = 1 then
      update public.messages as target_message
      set report_count = target_message.report_count + 1
      where target_message.id = p_message_id
      returning target_message.report_count into current_count;
    else
      select message.report_count into current_count
      from public.messages as message where message.id = p_message_id;
    end if;
  elsif p_target_kind = 'profile' then
    if p_profile_address is null or not exists (
      select 1 from public.user_profiles where bitcoin_address = p_profile_address
    ) then
      raise exception 'Profil introuvable';
    end if;
    if p_profile_address = p_reporter_address then
      raise exception 'Vous ne pouvez pas signaler votre propre profil';
    end if;

    insert into public.editorial_reports (
      reporter_address, target_kind, profile_address
    ) values (
      p_reporter_address, 'profile', p_profile_address
    ) on conflict do nothing;
    get diagnostics inserted_count = row_count;

    if inserted_count = 1 then
      update public.user_profiles as target_profile
      set report_count = target_profile.report_count + 1
      where target_profile.bitcoin_address = p_profile_address
      returning target_profile.report_count into current_count;
    else
      select profile.report_count into current_count
      from public.user_profiles as profile
      where profile.bitcoin_address = p_profile_address;
    end if;
  else
    raise exception 'Type de signalement invalide';
  end if;

  return query select inserted_count = 1, coalesce(current_count, 0);
end;
$$;

create or replace function public.refresh_editorial_message_risk(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.editorial_safety_settings%rowtype;
  event_count integer := 0;
  actor_count integer := 0;
  new_actor_count integer := 0;
  new_actor_ratio double precision := 0;
  calculated_score double precision := 0;
  calculated_reasons text[] := array[]::text[];
begin
  select * into settings
  from public.editorial_safety_settings
  where singleton;

  if not found or p_message_id is null then return; end if;

  with engagement_events as materialized (
    select vote.bitcoin_address as actor_address, vote.created_at as event_at
    from public.message_useful_votes as vote
    where vote.message_id = p_message_id
      and vote.created_at >= now() - make_interval(mins => settings.burst_window_minutes)

    union all

    select reply.bitcoin_address, reply.created_at
    from public.messages as reply
    where reply.parent_id = p_message_id
      and reply.deleted_at is null
      and reply.created_at >= now() - make_interval(mins => settings.burst_window_minutes)

    union all

    select repost.bitcoin_address, repost.created_at
    from public.messages as repost
    where repost.repost_of = p_message_id
      and repost.deleted_at is null
      and repost.created_at >= now() - make_interval(mins => settings.burst_window_minutes)
  ),
  actors as materialized (
    select event.actor_address, min(event.event_at) as first_event_at
    from engagement_events as event
    group by event.actor_address
  )
  select
    (select count(*) from engagement_events),
    count(*),
    count(*) filter (
      where profile.created_at is null
         or profile.created_at >= actors.first_event_at - make_interval(days => settings.new_account_days)
    )
  into event_count, actor_count, new_actor_count
  from actors
  left join public.user_profiles as profile
    on profile.bitcoin_address = actors.actor_address;

  new_actor_ratio := case
    when actor_count = 0 then 0
    else new_actor_count::double precision / actor_count::double precision
  end;

  if actor_count >= settings.burst_min_actors then
    calculated_score := calculated_score + 0.30;
    calculated_reasons := array_append(calculated_reasons, 'engagement_burst');
  end if;

  if actor_count >= 4 and new_actor_ratio >= settings.new_account_ratio_threshold then
    calculated_score := calculated_score + 0.40;
    calculated_reasons := array_append(calculated_reasons, 'new_account_concentration');
  end if;

  if actor_count >= 4 and event_count >= actor_count * 2 then
    calculated_score := calculated_score + 0.20;
    calculated_reasons := array_append(calculated_reasons, 'coordinated_multi_action');
  end if;

  insert into public.editorial_message_risk (
    message_id,
    risk_score,
    reason_codes,
    engagement_count,
    unique_actor_count,
    checked_at
  ) values (
    p_message_id,
    least(0.90, calculated_score),
    calculated_reasons,
    event_count,
    actor_count,
    now()
  )
  on conflict (message_id) do update set
    risk_score = excluded.risk_score,
    reason_codes = excluded.reason_codes,
    engagement_count = excluded.engagement_count,
    unique_actor_count = excluded.unique_actor_count,
    checked_at = excluded.checked_at;
end;
$$;

create or replace function public.refresh_editorial_risk_from_useful()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_editorial_message_risk(coalesce(new.message_id, old.message_id));
  return coalesce(new, old);
end;
$$;

create or replace function public.refresh_editorial_risk_from_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_target uuid := coalesce(old.parent_id, old.repost_of);
  new_target uuid := coalesce(new.parent_id, new.repost_of);
begin
  if old_target is not null then perform public.refresh_editorial_message_risk(old_target); end if;
  if new_target is not null and new_target is distinct from old_target then
    perform public.refresh_editorial_message_risk(new_target);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists editorial_refresh_risk_useful on public.message_useful_votes;
create trigger editorial_refresh_risk_useful
after insert or delete on public.message_useful_votes
for each row execute function public.refresh_editorial_risk_from_useful();

drop trigger if exists editorial_refresh_risk_messages on public.messages;
create trigger editorial_refresh_risk_messages
after insert or delete or update of deleted_at on public.messages
for each row execute function public.refresh_editorial_risk_from_message();

revoke all on function public.set_editorial_author_preference(text, text, text)
  from public, anon, authenticated;
revoke all on function public.record_editorial_report(text, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.refresh_editorial_message_risk(uuid)
  from public, anon, authenticated;
revoke all on function public.refresh_editorial_risk_from_useful()
  from public, anon, authenticated;
revoke all on function public.refresh_editorial_risk_from_message()
  from public, anon, authenticated;

grant execute on function public.set_editorial_author_preference(text, text, text) to service_role;
grant execute on function public.record_editorial_report(text, text, uuid, text) to service_role;
grant execute on function public.refresh_editorial_message_risk(uuid) to service_role;

-- Backfill only recent roots that already have engagement. Future activity is
-- covered synchronously by the triggers above.
do $$
declare
  target record;
begin
  for target in
    select message.id
    from public.messages as message
    where message.parent_id is null
      and message.deleted_at is null
      and message.created_at >= now() - interval '30 days'
      and (
        exists (select 1 from public.message_useful_votes where message_id = message.id)
        or exists (select 1 from public.messages where parent_id = message.id and deleted_at is null)
        or exists (select 1 from public.messages where repost_of = message.id and deleted_at is null)
      )
    order by message.created_at desc
    limit 2000
  loop
    perform public.refresh_editorial_message_risk(target.id);
  end loop;
end $$;
