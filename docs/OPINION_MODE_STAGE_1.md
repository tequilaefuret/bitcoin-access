# Opinion mode - Stage 1

> Historical reference: the manual selection and `perspective_bucket` workflow
> described below is no longer read by the Opinion feed. Since migration
> `202608040002`, topic relevance is model-only and no author, reader or
> moderator can assign a publication orientation. See
> [Opinion quality, cycles and validation](OPINION_MODE_QUALITY_CYCLES.md).

This document describes the first functional foundation of the Danaus Opinion feed.

## Product rules implemented

- The social screen has two modes: `Classic` and `Opinion`.
- `Classic` contains the complete post feed.
- `Opinion` contains only posts explicitly selected for an active subject.
- A post can receive one public signal: `Useful`.
- There is no downvote in this stage.
- Adding `Useful` locks `1` shell, the same amount as the former like. Removing it returns that shell.
- Posts can be ordered by recency or by their `Useful` count in Classic mode.
- Perspective buckets exist only to build a varied selection.
- Perspective buckets are removed from the server response and never displayed to readers.
- Opinion posts are shuffled before being returned.
- There is no automatic or neutral summary.
- A reader can save a private stance after reading a subject.

## What selection means in Stage 1

The target is eventually to select a small share of the Classic feed, around 5% as an initial product hypothesis. Stage 1 does not pretend to know that percentage automatically.

Selection is explicit and editorial for now:

1. Readers mark useful posts in the Classic feed.
2. An administrator reviews useful posts that are relevant to an active subject.
3. The administrator associates a post with the subject and an internal perspective bucket.
4. The server takes up to two posts from each bucket, completes the selection with the strongest remaining posts, and shuffles the result.

This creates reliable training and evaluation data before an automated classifier is introduced.

## Database tables

### `message_useful_votes`

Stores one `Useful` signal per reader and message. Adding the signal and debiting its cost happen atomically in the database. A database trigger maintains `messages.useful_count` so that the Classic feed can be sorted efficiently.

### `opinion_topics`

Stores active editorial questions. Stage 1 seeds four pilot subjects:

- Inflation and savings
- Remote work and productivity
- Nuclear power
- AI regulation

The `question` field is shown directly. There is no generated summary field.

### `opinion_topic_messages`

Associates a real post or comment with a subject.

The internal `perspective_bucket` values are:

- `side_a`
- `side_b`
- `bridge`
- `question`

These neutral technical names are intentional. They avoid treating one side as the default or exposing labels to readers.

### `private_topic_stances`

Stores the stance of the authenticated reader. All new Opinion tables have Row Level Security enabled and no direct browser policy. Access goes through the service-role backend.

## Manually selecting a real post

The following actions are performed in the Supabase SQL Editor. They are an administrative operation, not something a normal reader can do.

First, list useful posts:

```sql
select
  id,
  content,
  useful_count,
  created_at
from public.messages
where deleted_at is null
  and parent_id is null
order by useful_count desc, created_at desc
limit 50;
```

Then list active subjects:

```sql
select id, slug, title, question
from public.opinion_topics
where status = 'active'
order by sort_rank;
```

Finally, associate one message with a subject. Replace the two example UUID values and choose the correct internal bucket:

```sql
insert into public.opinion_topic_messages (
  topic_id,
  message_id,
  perspective_bucket,
  selection_source,
  quality_score
)
values (
  'TOPIC_UUID',
  'MESSAGE_UUID',
  'side_a',
  'manual',
  1
)
on conflict (topic_id, message_id) do update set
  perspective_bucket = excluded.perspective_bucket,
  selection_source = excluded.selection_source,
  quality_score = excluded.quality_score,
  selected_at = now();
```

Readers will see the selected post, but they will not receive `perspective_bucket`, `selection_source` or `quality_score`.

## Deployment

The code is complete locally, but database and Edge Function changes must be deployed to the linked Supabase project before authenticated users can use them.

From the project directory:

```bash
supabase db push
supabase functions deploy user-operations
```

After deployment, rebuild or restart the React application:

```bash
npm start
```

## Privacy boundary

Private means other readers and the public client cannot retrieve an individual stance. The Supabase service role and project administrator can still access the table. A future cryptographically private design would require local-only or encrypted storage and would change aggregation and synchronization capabilities.

## Deferred work

The following items are deliberately outside Stage 1:

- automatic selection of the top topic-relevant percentage;
- semantic embeddings and clustering;
- automatic perspective classification;
- generated summaries;
- source reliability scoring;
- autonomous publishing agents;
- shell rewards based on usefulness.
