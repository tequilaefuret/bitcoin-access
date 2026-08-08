-- Least-privilege database access for the external Opinion embedding worker.
-- Environment-specific login roles inherit this non-login role.

do $$
declare
  existing_role record;
begin
  select
    rolsuper,
    rolcreaterole,
    rolcreatedb,
    rolreplication,
    rolcanlogin
  into existing_role
  from pg_roles
  where rolname = 'danaus_opinion_worker';

  if not found then
    create role danaus_opinion_worker
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication;
  elsif existing_role.rolsuper
    or existing_role.rolcreaterole
    or existing_role.rolcreatedb
    or existing_role.rolreplication
    or existing_role.rolcanlogin then
    raise exception
      'Existing danaus_opinion_worker role has unsafe attributes';
  end if;
end;
$$;

do $$
begin
  execute format(
    'grant connect on database %I to danaus_opinion_worker',
    current_database()
  );
end;
$$;

grant usage on schema public to danaus_opinion_worker;
grant usage on schema extensions to danaus_opinion_worker;

grant select (singleton, embedding_model)
  on public.opinion_classifier_settings
  to danaus_opinion_worker;

grant select (id, content, deleted_at)
  on public.messages
  to danaus_opinion_worker;

grant select (id, category, title, question, status)
  on public.opinion_topics
  to danaus_opinion_worker;

grant select (message_id, content_hash, status, model, attempt_count),
  update (embedding, model, status, attempt_count, last_error, updated_at)
  on public.message_embeddings
  to danaus_opinion_worker;

grant select (topic_id, content_hash, status, model, attempt_count),
  update (embedding, model, status, attempt_count, last_error, updated_at)
  on public.opinion_topic_embeddings
  to danaus_opinion_worker;

drop policy if exists opinion_worker_read_settings
  on public.opinion_classifier_settings;
create policy opinion_worker_read_settings
  on public.opinion_classifier_settings
  for select
  to danaus_opinion_worker
  using (true);

drop policy if exists opinion_worker_read_messages
  on public.messages;
create policy opinion_worker_read_messages
  on public.messages
  for select
  to danaus_opinion_worker
  using (true);

drop policy if exists opinion_worker_read_topics
  on public.opinion_topics;
create policy opinion_worker_read_topics
  on public.opinion_topics
  for select
  to danaus_opinion_worker
  using (true);

drop policy if exists opinion_worker_read_message_embeddings
  on public.message_embeddings;
create policy opinion_worker_read_message_embeddings
  on public.message_embeddings
  for select
  to danaus_opinion_worker
  using (true);

drop policy if exists opinion_worker_update_message_embeddings
  on public.message_embeddings;
create policy opinion_worker_update_message_embeddings
  on public.message_embeddings
  for update
  to danaus_opinion_worker
  using (true)
  with check (true);

drop policy if exists opinion_worker_read_topic_embeddings
  on public.opinion_topic_embeddings;
create policy opinion_worker_read_topic_embeddings
  on public.opinion_topic_embeddings
  for select
  to danaus_opinion_worker
  using (true);

drop policy if exists opinion_worker_update_topic_embeddings
  on public.opinion_topic_embeddings;
create policy opinion_worker_update_topic_embeddings
  on public.opinion_topic_embeddings
  for update
  to danaus_opinion_worker
  using (true)
  with check (true);

create or replace function public.claim_opinion_embedding_jobs(
  p_visibility_timeout integer default 300,
  p_quantity integer default 8
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(job) order by job.msg_id), '[]'::jsonb)
  from pgmq.read(
    queue_name => 'opinion_embeddings',
    vt => least(greatest(p_visibility_timeout, 30), 1800),
    qty => least(greatest(p_quantity, 1), 64)
  ) as job;
$$;

create or replace function public.archive_opinion_embedding_job(p_msg_id bigint)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select pgmq.archive('opinion_embeddings', p_msg_id);
$$;

revoke all on function public.claim_opinion_embedding_jobs(integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.archive_opinion_embedding_job(bigint)
  from public, anon, authenticated, service_role;

grant execute on function public.claim_opinion_embedding_jobs(integer, integer)
  to danaus_opinion_worker;
grant execute on function public.archive_opinion_embedding_job(bigint)
  to danaus_opinion_worker;
grant execute on function public.classify_opinion_message(uuid)
  to danaus_opinion_worker;
grant execute on function public.reclassify_all_opinion_messages()
  to danaus_opinion_worker;
