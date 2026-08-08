# Opinion mode - Stage 2 automatic grouping

> This document still describes worker installation and operations. Its initial
> single-topic classifier was superseded by migration `202608040002`; see
> [Opinion quality, cycles and validation](OPINION_MODE_QUALITY_CYCLES.md) for
> the current multi-topic rules, contextual comments and calibrated thresholds.

Stage 2 groups posts and comments into existing Opinion topics without a paid AI API.

## Architecture

1. A database trigger detects a new or edited message.
2. The trigger writes a durable job to the `opinion_embeddings` PGMQ queue.
3. The Docker worker reads jobs in batches.
4. A pinned `intfloat/multilingual-e5-small` revision generates normalized
   384-dimension embeddings locally on CPU. A comment combines its root,
   immediate parent when present, and own text.
5. The worker stores the embedding in a private table.
6. PostgreSQL compares it with active topic embeddings through pgvector cosine distance.
7. Every topic is independently compared with its calibrated threshold.
8. One message can match several topics; every other result remains uncertain.

The model is multilingual, MIT-licensed and runs locally. Its tested revision is
built into the Docker image and loaded offline at runtime. There is no AI
subscription and no post content is sent to an embedding API.

## Classification rule

The model name and conservative fallback are stored in
`public.opinion_classifier_settings`. Topic-specific thresholds are stored in
`public.opinion_topic_classifier_settings`:

- fallback cosine similarity: `0.85`;
- calibrated pilot-topic thresholds: `0.844` to `0.854`;
- embedding model: `intfloat/multilingual-e5-small`.

A message is independently accepted for every topic whose threshold it passes.
Margin is retained only as a legacy diagnostic. Otherwise:

- `below_similarity_threshold` means no topic is close enough;
- `no_active_topic_embeddings` means the active topics are not ready yet.

Uncertain rows keep the best candidate only for server-side diagnostics. The accepted `topic_id` remains `NULL`, and the post is not returned in the Opinion feed.

## Private database objects

- `message_embeddings`: message vectors and processing state;
- `opinion_topic_embeddings`: active topic vectors and processing state;
- `opinion_message_topic_scores`: current score for every message/topic pair;
- `opinion_message_topic_matches`: legacy best-candidate diagnostics;
- `opinion_classifier_settings`: model and confidence thresholds;
- `opinion_topic_classifier_settings`: calibrated per-topic thresholds;
- `pgmq.q_opinion_embeddings`: pending and temporarily invisible jobs;
- `pgmq.a_opinion_embeddings`: archived completed jobs.

All embedding and classification tables use RLS and revoke browser roles. The
worker inherits the non-login `danaus_opinion_worker` database role, which can
only:

- read the text required to generate embeddings;
- update embedding processing rows;
- claim and archive Opinion queue jobs through restricted functions;
- execute the database classification functions.

The worker connects directly to PostgreSQL. Its password must never be exposed
to React or stored in a committed file.

## DEV database deployment

The DEV administrator password is stored only in the ignored file
`.secrets/supabase_dev_admin_password`, with mode `600`. It is used for database
migrations, never by the worker. Check pending migrations first, then apply
them:

```bash
npm run supabase:dev:push:dry-run
npm run supabase:dev:push
```

The migration enables `vector` and `pgmq`, creates the queue, installs triggers, then enqueues active topics before existing messages.

If Supabase refuses to create PGMQ from the migration, enable **Queues** in the
DEV project Dashboard under **Integrations**, then run
`npm run supabase:dev:push` again. PGMQ requires a sufficiently recent Supabase
Postgres release.

The `user-operations` function must also include the automatic matches:

```bash
supabase functions deploy user-operations
```

## DEV worker account

Create a long random password locally. Do not reuse the Supabase account or
`postgres` password, and do not send this password in a chat:

```bash
openssl rand -hex 32
```

After applying the migration, open the **SQL Editor** of the DEV project and run
the following query. Replace only the value between quotes:

```sql
create role danaus_opinion_worker_dev
  with login
  password 'REPLACE_WITH_THE_RANDOM_DEV_PASSWORD'
  inherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  connection limit 3;

grant danaus_opinion_worker to danaus_opinion_worker_dev;
```

If `danaus_opinion_worker_dev` already exists, rotate its password instead:

```sql
alter role danaus_opinion_worker_dev
  with login
  password 'REPLACE_WITH_A_NEW_RANDOM_DEV_PASSWORD'
  inherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  connection limit 3;

grant danaus_opinion_worker to danaus_opinion_worker_dev;
```

In **Project Settings > Database > Connection string**, select the **Session
pooler** connection. Replace its user with
`danaus_opinion_worker_dev.PROJECT_REF`, replace its password, and keep
`sslmode=require`. The result has this form:

```text
postgresql://danaus_opinion_worker_dev.PROJECT_REF:URL_ENCODED_PASSWORD@POOLER_HOST:5432/postgres?sslmode=require
```

The hexadecimal password generated above can be pasted directly into the URL.
If another password format is used, its special characters must be URL-encoded.

Create the local Docker secret directory:

```bash
mkdir -p .secrets
chmod 700 .secrets
```

Create `.secrets/opinion_database_url` in the project. Its only line must be the
complete connection string, without `DATABASE_URL=` and without quotes. Then
restrict access to your Linux user:

```bash
chmod 600 .secrets/opinion_database_url
```

The old `.env.opinion-worker` file is no longer used by Docker. Delete it after
the dedicated secret works, because it may still contain the administrator
connection string. `.env.opinion-worker.example` now documents non-secret
optional settings only.

Important rules:

- never commit `.secrets/opinion_database_url`;
- never use this connection string in `REACT_APP_*` variables;
- never use the `postgres`, `service_role`, DEV, or production password in
  another environment;
- keep `EMBEDDING_MODEL` equal to the value in `opinion_classifier_settings`.

## Docker commands

Docker and Docker Compose are installed. Verify that the current Linux session
can reach the Docker daemon:

```bash
docker info
docker compose version
```

Build and start the worker:

```bash
npm run opinion:up
```

The first build downloads the CPU version of PyTorch and the embedding model. It is slower and larger than later starts, but no inference subscription is required.

The container entrypoint reads the mounted secret while privileged, removes the
secret-file path from the worker environment, then immediately starts Python as
the non-root `worker` user.

Follow processing logs:

```bash
npm run opinion:logs
```

Stop the worker:

```bash
npm run opinion:down
```

The worker must keep running to process new publications. If it is stopped, jobs remain durable in PostgreSQL and resume when the container restarts.

If a trigger could not enqueue work, restore every non-ready or outdated item from the SQL Editor:

```sql
select public.requeue_opinion_embedding_jobs(false);
```

Passing `true` forces regeneration of every topic and message embedding and should be reserved for an embedding-model change.

## Production deployment

Production must have its own Supabase project, login and random password. Apply
the migrations to PROD, then create `danaus_opinion_worker_prod` in its SQL
Editor with the same restricted options used for DEV:

```sql
create role danaus_opinion_worker_prod
  with login
  password 'REPLACE_WITH_THE_RANDOM_PROD_PASSWORD'
  inherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  connection limit 3;

grant danaus_opinion_worker to danaus_opinion_worker_prod;
```

On the production Linux server, store the PROD connection string outside the
Git checkout:

```bash
sudo mkdir -p /etc/danaus
sudo chmod 700 /etc/danaus
sudoedit /etc/danaus/opinion_database_url
sudo chmod 600 /etc/danaus/opinion_database_url
```

As in DEV, the file contains only the connection string. Start the production
worker with both Compose files:

```bash
docker compose \
  -f docker-compose.opinion.yml \
  -f docker-compose.opinion.production.yml \
  up -d --build
```

The production override uses `restart: always` and mounts the secret from
`/etc/danaus/opinion_database_url`. On a managed container platform, store the
URL in that platform's secret manager instead; the worker also accepts a
server-side `DATABASE_URL` environment variable as a fallback.

## Operational checks

Run these queries in the Supabase SQL Editor for the DEV project.

Extensions:

```sql
select extname, extversion
from pg_extension
where extname in ('vector', 'pgmq')
order by extname;
```

Embedding states:

```sql
select status, count(*)
from public.message_embeddings
group by status
order by status;
```

Classification states:

```sql
select status, count(*)
from public.opinion_message_topic_matches
group by status
order by status;
```

Uncertainty reasons:

```sql
select uncertainty_reason, count(*)
from public.opinion_message_topic_matches
where status = 'uncertain'
group by uncertainty_reason
order by count(*) desc;
```

Review uncertain examples without changing their classification:

```sql
select
  left(message.content, 180) as content_preview,
  candidate.title as best_candidate,
  match.similarity_score,
  match.second_best_score,
  match.confidence_margin,
  match.uncertainty_reason
from public.opinion_message_topic_matches as match
join public.messages as message on message.id = match.message_id
left join public.opinion_topics as candidate on candidate.id = match.candidate_topic_id
where match.status = 'uncertain'
order by match.classified_at desc
limit 50;
```

## Threshold calibration

Do not lower thresholds only to increase the number of grouped posts. First review false positives and false negatives on real DEV data.

Example threshold update for one topic after a measured validation run:

```sql
update public.opinion_topic_classifier_settings as settings
set
  min_similarity = 0.852,
  updated_at = now()
from public.opinion_topics as topic
where settings.topic_id = topic.id
  and topic.slug = 'nuclear-power';

select pgmq.send(
  queue_name => 'opinion_embeddings',
  msg => '{"action":"reclassify_all"}'::jsonb
);
```

Lower similarity accepts broader semantic links and raises false positives. Do
not change a threshold without running the versioned evaluator and reviewing a
human gold subset.

## Current boundary

This stage detects topic relevance only. It does not infer whether a post is
favorable, unfavorable, nuanced or a question. The Opinion feed no longer reads
editorial perspective buckets, and no user-facing or administrative operation
can assign an orientation. The reader's private stance never affects topic
classification or ranking.

Automatic perspective classification, generated summaries, source reliability scoring and autonomous publishing agents remain deferred.
