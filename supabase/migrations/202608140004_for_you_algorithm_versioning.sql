-- Version registry and attribution for the Danaus For-you algorithm.
--
-- A semantic version identifies both the ranking code released by migrations
-- and the exact settings snapshot used by that release. Impressions keep this
-- immutable label so future quality measurements and rollbacks remain honest.

create table if not exists public.for_you_algorithm_versions (
  version text primary key,
  implementation_version text not null,
  configuration jsonb not null,
  release_notes text not null,
  is_activatable boolean not null default true,
  created_at timestamptz not null default now(),
  constraint for_you_algorithm_versions_format_check check (
    version ~ '^for-you-v[0-9]+\.[0-9]+\.[0-9]+$'
  ),
  constraint for_you_algorithm_versions_implementation_check check (
    implementation_version = 'legacy'
    or implementation_version ~ '^for-you-v[0-9]+\.[0-9]+\.[0-9]+$'
  ),
  constraint for_you_algorithm_versions_configuration_check check (
    jsonb_typeof(configuration) = 'object'
  ),
  constraint for_you_algorithm_versions_notes_check check (
    char_length(release_notes) between 1 and 500
  ),
  constraint for_you_algorithm_versions_legacy_activation_check check (
    implementation_version <> 'legacy' or not is_activatable
  )
);

-- Historical rows predate reliable version attribution. Keep them separate
-- instead of pretending that they were produced by the new 1.0.0 release.
insert into public.for_you_algorithm_versions (
  version,
  implementation_version,
  configuration,
  release_notes,
  is_activatable
) values (
  'for-you-v0.0.0',
  'legacy',
  '{"legacy": true}'::jsonb,
  'Historical recommendations served before algorithm versioning was available.',
  false
)
on conflict (version) do nothing;

alter table public.for_you_algorithm_settings
  add column if not exists algorithm_version text not null default 'for-you-v1.0.0';

-- Capture the complete, already validated configuration as version 1.0.0.
-- Operational metadata is excluded so that the snapshot contains only inputs
-- that can affect recommendation scoring.
insert into public.for_you_algorithm_versions (
  version,
  implementation_version,
  configuration,
  release_notes
)
select
  settings.algorithm_version,
  'for-you-v1.0.0',
  to_jsonb(settings) - 'singleton' - 'updated_at' - 'algorithm_version',
  'Initial versioned release: normalized engagement, ten-day exponential decay, editorial filtering and complementary weak signals.'
from public.for_you_algorithm_settings as settings
where settings.singleton
on conflict (version) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'for_you_algorithm_settings_version_fk'
      and conrelid = 'public.for_you_algorithm_settings'::regclass
  ) then
    alter table public.for_you_algorithm_settings
      add constraint for_you_algorithm_settings_version_fk
      foreign key (algorithm_version)
      references public.for_you_algorithm_versions(version)
      on update restrict
      on delete restrict;
  end if;
end $$;

-- Append-only activation history distinguishes a new release from a rollback.
create table if not exists public.for_you_algorithm_activations (
  id bigint generated always as identity primary key,
  algorithm_version text not null
    references public.for_you_algorithm_versions(version) on delete restrict,
  reason text not null,
  activated_at timestamptz not null default now(),
  constraint for_you_algorithm_activations_reason_check check (
    char_length(reason) between 1 and 500
  )
);

insert into public.for_you_algorithm_activations (algorithm_version, reason)
select settings.algorithm_version, 'Initial versioning deployment'
from public.for_you_algorithm_settings as settings
where settings.singleton
  and not exists (
    select 1 from public.for_you_algorithm_activations
  );

alter table public.for_you_algorithm_versions enable row level security;
alter table public.for_you_algorithm_activations enable row level security;

revoke all on table public.for_you_algorithm_versions
  from public, anon, authenticated;
revoke all on table public.for_you_algorithm_activations
  from public, anon, authenticated;
grant select on table public.for_you_algorithm_versions to service_role;
grant select on table public.for_you_algorithm_activations to service_role;
revoke update on table public.for_you_algorithm_settings from service_role;

-- Implementation functions are retained across releases. The dispatcher can
-- therefore route a rollback to both the previous settings and previous code.
create or replace function public.for_you_algorithm_function_name(
  p_implementation_version text
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_implementation_version ~ '^for-you-v[0-9]+\.[0-9]+\.[0-9]+$'
      then 'rank_for_you_feed_v'
        || replace(replace(p_implementation_version, 'for-you-v', ''), '.', '_')
    else null
  end;
$$;

revoke all on function public.for_you_algorithm_function_name(text)
  from public, anon, authenticated, service_role;

do $$
begin
  if to_regprocedure('public.rank_for_you_feed_v1_0_0(text,integer)') is null then
    alter function public.rank_for_you_feed(text, integer)
      rename to rank_for_you_feed_v1_0_0;
  end if;
end $$;

revoke all on function public.rank_for_you_feed_v1_0_0(text, integer)
  from public, anon, authenticated, service_role;

create or replace function public.rank_for_you_feed(
  p_bitcoin_address text,
  p_limit integer default 20
)
returns table (
  message_id uuid,
  rank_score double precision,
  candidate_source text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  active_implementation text;
  implementation_function text;
begin
  select version.implementation_version
  into active_implementation
  from public.for_you_algorithm_settings as settings
  join public.for_you_algorithm_versions as version
    on version.version = settings.algorithm_version
  where settings.singleton;

  implementation_function := public.for_you_algorithm_function_name(active_implementation);

  if implementation_function is null
    or to_regprocedure(format('%I.%I(text,integer)', 'public', implementation_function)) is null then
    raise exception 'Implémentation For you indisponible';
  end if;

  return query execute format(
    'select * from %I.%I($1, $2)',
    'public',
    implementation_function
  ) using p_bitcoin_address, p_limit;
end;
$$;

revoke all on function public.rank_for_you_feed(text, integer)
  from public, anon, authenticated;
grant execute on function public.rank_for_you_feed(text, integer) to service_role;

-- Restore the complete settings snapshot for a registered version. New
-- versions themselves are created only by reviewed SQL migrations; the server
-- can activate an existing one but cannot rewrite the immutable registry.
create or replace function public.activate_for_you_algorithm_version(
  p_algorithm_version text,
  p_reason text default 'Manual activation'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  registered_configuration jsonb;
  registered_implementation text;
  implementation_function text;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Le motif d’activation est obligatoire';
  end if;

  select version.configuration, version.implementation_version
  into registered_configuration, registered_implementation
  from public.for_you_algorithm_versions as version
  where version.version = p_algorithm_version
    and version.is_activatable;

  if registered_configuration is null then
    raise exception 'Version For you inconnue ou non réactivable';
  end if;

  implementation_function := public.for_you_algorithm_function_name(registered_implementation);
  if implementation_function is null
    or to_regprocedure(format('%I.%I(text,integer)', 'public', implementation_function)) is null then
    raise exception 'Implémentation For you indisponible';
  end if;

  update public.for_you_algorithm_settings
  set
    candidate_lookback_days = (registered_configuration ->> 'candidate_lookback_days')::integer,
    history_lookback_days = (registered_configuration ->> 'history_lookback_days')::integer,
    semantic_weight = (registered_configuration ->> 'semantic_weight')::double precision,
    author_affinity_weight = (registered_configuration ->> 'author_affinity_weight')::double precision,
    engagement_weight = (registered_configuration ->> 'engagement_weight')::double precision,
    freshness_weight = (registered_configuration ->> 'freshness_weight')::double precision,
    in_network_weight = (registered_configuration ->> 'in_network_weight')::double precision,
    exploration_weight = (registered_configuration ->> 'exploration_weight')::double precision,
    author_diversity_decay = (registered_configuration ->> 'author_diversity_decay')::double precision,
    author_diversity_floor = (registered_configuration ->> 'author_diversity_floor')::double precision,
    interaction_decay_days = (registered_configuration ->> 'interaction_decay_days')::double precision,
    interaction_decay_floor = (registered_configuration ->> 'interaction_decay_floor')::double precision,
    engagement_prior_impressions = (registered_configuration ->> 'engagement_prior_impressions')::double precision,
    core_score_weight = (registered_configuration ->> 'core_score_weight')::double precision,
    social_proof_weight = (registered_configuration ->> 'social_proof_weight')::double precision,
    conversation_quality_weight = (registered_configuration ->> 'conversation_quality_weight')::double precision,
    engagement_breadth_weight = (registered_configuration ->> 'engagement_breadth_weight')::double precision,
    social_proof_saturation = (registered_configuration ->> 'social_proof_saturation')::double precision,
    conversation_quality_saturation = (registered_configuration ->> 'conversation_quality_saturation')::double precision,
    engagement_breadth_saturation = (registered_configuration ->> 'engagement_breadth_saturation')::double precision,
    algorithm_version = p_algorithm_version,
    updated_at = now()
  where singleton;

  if not found then
    raise exception 'Configuration For you introuvable';
  end if;

  insert into public.for_you_algorithm_activations (
    algorithm_version,
    reason,
    activated_at
  ) values (
    p_algorithm_version,
    btrim(p_reason),
    now()
  );

  return p_algorithm_version;
end;
$$;

revoke all on function public.activate_for_you_algorithm_version(text, text)
  from public, anon, authenticated;
grant execute on function public.activate_for_you_algorithm_version(text, text)
  to service_role;

-- Keep the public ranking contract stable and expose the version through a
-- dedicated server-only RPC. This avoids breaking old deployments during the
-- database-first rollout order.
create or replace function public.rank_for_you_feed_versioned(
  p_bitcoin_address text,
  p_limit integer default 20
)
returns table (
  message_id uuid,
  rank_score double precision,
  candidate_source text,
  algorithm_version text
)
language sql
stable
security definer
set search_path = ''
as $$
  with active_version as materialized (
    select settings.algorithm_version
    from public.for_you_algorithm_settings as settings
    where settings.singleton
    limit 1
  )
  select
    ranked.message_id,
    ranked.rank_score,
    ranked.candidate_source,
    active.algorithm_version
  from public.rank_for_you_feed(p_bitcoin_address, p_limit) as ranked
  cross join active_version as active;
$$;

revoke all on function public.rank_for_you_feed_versioned(text, integer)
  from public, anon, authenticated;
grant execute on function public.rank_for_you_feed_versioned(text, integer)
  to service_role;

-- Attribute every served recommendation to the version that produced it.
alter table public.for_you_impressions
  add column if not exists algorithm_version text;

update public.for_you_impressions as impression
set algorithm_version = 'for-you-v0.0.0'
where impression.algorithm_version is null;

alter table public.for_you_impressions
  alter column algorithm_version set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'for_you_impressions_version_fk'
      and conrelid = 'public.for_you_impressions'::regclass
  ) then
    alter table public.for_you_impressions
      add constraint for_you_impressions_version_fk
      foreign key (algorithm_version)
      references public.for_you_algorithm_versions(version)
      on update restrict
      on delete restrict;
  end if;
end $$;

create index if not exists for_you_impressions_version_served_idx
  on public.for_you_impressions (algorithm_version, served_at desc);

create or replace function public.record_for_you_impressions(
  p_bitcoin_address text,
  p_request_id uuid,
  p_message_ids uuid[],
  p_algorithm_version text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer := 0;
begin
  if p_bitcoin_address is null or p_request_id is null then
    raise exception 'Contexte For you incomplet';
  end if;

  if not exists (
    select 1
    from public.for_you_algorithm_versions as version
    where version.version = p_algorithm_version
  ) then
    raise exception 'Version For you inconnue';
  end if;

  if coalesce(cardinality(p_message_ids), 0) > 20 then
    raise exception 'Lot For you trop grand';
  end if;

  delete from public.for_you_impressions
  where bitcoin_address = p_bitcoin_address
    and served_at < now() - interval '90 days';

  insert into public.for_you_impressions (
    bitcoin_address,
    request_id,
    message_id,
    rank_position,
    served_at,
    algorithm_version
  )
  select
    p_bitcoin_address,
    p_request_id,
    ranked.message_id,
    ranked.ordinality::integer - 1,
    now(),
    p_algorithm_version
  from unnest(coalesce(p_message_ids, array[]::uuid[]))
    with ordinality as ranked(message_id, ordinality)
  join public.messages as message
    on message.id = ranked.message_id and message.deleted_at is null
  on conflict (bitcoin_address, request_id, message_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

-- Backward-compatible entry point for an Edge Function that has not yet been
-- redeployed. It records the version active in the same database transaction.
create or replace function public.record_for_you_impressions(
  p_bitcoin_address text,
  p_request_id uuid,
  p_message_ids uuid[]
)
returns integer
language sql
security definer
set search_path = ''
as $$
  select public.record_for_you_impressions(
    p_bitcoin_address,
    p_request_id,
    p_message_ids,
    settings.algorithm_version
  )
  from public.for_you_algorithm_settings as settings
  where settings.singleton;
$$;

revoke all on function public.record_for_you_impressions(text, uuid, uuid[], text)
  from public, anon, authenticated;
revoke all on function public.record_for_you_impressions(text, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.record_for_you_impressions(text, uuid, uuid[], text)
  to service_role;
grant execute on function public.record_for_you_impressions(text, uuid, uuid[])
  to service_role;

-- Attribute explicit negative feedback to the version of the latest matching
-- impression. The preference itself remains valid across later versions.
alter table public.for_you_feedback
  add column if not exists source_algorithm_version text;

update public.for_you_feedback as feedback
set source_algorithm_version = 'for-you-v0.0.0'
where feedback.source_algorithm_version is null;

alter table public.for_you_feedback
  alter column source_algorithm_version set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'for_you_feedback_version_fk'
      and conrelid = 'public.for_you_feedback'::regclass
  ) then
    alter table public.for_you_feedback
      add constraint for_you_feedback_version_fk
      foreign key (source_algorithm_version)
      references public.for_you_algorithm_versions(version)
      on update restrict
      on delete restrict;
  end if;
end $$;

create or replace function public.record_for_you_feedback(
  p_bitcoin_address text,
  p_message_id uuid,
  p_feedback_kind text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_message_id uuid;
  feedback_algorithm_version text;
begin
  if p_feedback_kind <> 'not_interested' then
    raise exception 'Signal For you invalide';
  end if;

  select coalesce(message.repost_of, message.id)
  into canonical_message_id
  from public.messages as message
  where message.id = p_message_id and message.deleted_at is null;

  if canonical_message_id is null then
    raise exception 'Publication introuvable';
  end if;

  select impression.algorithm_version
  into feedback_algorithm_version
  from public.for_you_impressions as impression
  join public.messages as served_message
    on served_message.id = impression.message_id
  where impression.bitcoin_address = p_bitcoin_address
    and coalesce(served_message.repost_of, served_message.id) = canonical_message_id
  order by impression.served_at desc
  limit 1;

  if feedback_algorithm_version is null then
    select settings.algorithm_version
    into feedback_algorithm_version
    from public.for_you_algorithm_settings as settings
    where settings.singleton;
  end if;

  insert into public.for_you_feedback (
    bitcoin_address,
    message_id,
    feedback_kind,
    source_algorithm_version,
    created_at,
    updated_at
  ) values (
    p_bitcoin_address,
    canonical_message_id,
    p_feedback_kind,
    feedback_algorithm_version,
    now(),
    now()
  )
  on conflict (bitcoin_address, message_id) do update set
    feedback_kind = excluded.feedback_kind,
    source_algorithm_version = excluded.source_algorithm_version,
    updated_at = now();
end;
$$;

revoke all on function public.record_for_you_feedback(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_for_you_feedback(text, uuid, text)
  to service_role;
