# Opinion mode - Stage 3B automatic topic discovery

Migration `202608050002_opinion_topic_discovery.sql` identifies coherent groups
of recent root posts that do not match an existing Opinion topic. It uses the
same local multilingual E5 embeddings as Stage 2 and requires no paid API.

Discovery and publication are deliberately separate. The algorithm creates
private candidates; it never invents a title, question, category or alleged
neutral summary and never exposes a raw cluster to readers.

## Eligible roots

A publication can seed or join a candidate only when it is:

- a root post rather than a comment;
- less than 48 hours old;
- at least 60 characters long;
- neither deleted, test content nor a repost;
- backed by a ready embedding from the configured model;
- not accepted by any existing Opinion topic;
- not an exact normalized duplicate already processed by discovery.

Comments do not create topics on their own. Once a candidate is promoted, the
existing contextual classifier can attach comments using their root and parent
context.

## Conservative clustering

Each active candidate stores a 384-dimension centroid and a representative root
post. A new root must simultaneously reach cosine similarity `0.90` against:

1. the current centroid;
2. the representative publication.

After every assignment, the centroid and representative are recomputed. The
candidate also retains every member's similarity against both references. This
prevents centroid drift from silently joining a chain of increasingly unrelated
posts.

There is no balance-based weighting. One rich wallet cannot make its text more
similar, and repeated roots from one author cannot qualify a candidate.

## Candidate lifecycle

- `collecting`: one or more coherent roots, but insufficient independent proof;
- `qualified`: at least 3 roots from 3 distinct authors, average similarity at
  least `0.90` and minimum member similarity at least `0.88`;
- `promoted`: a service-side review supplied the public category, title and
  question and created an active Opinion topic;
- `rejected`: a reviewer determined that the cluster is noise, unsafe or not a
  useful debate;
- `expired`: no new root joined the candidate for 72 hours.

Qualification does not make the candidate visible. It only moves it into the
private review queue. `Useful` voters contribute to the internal discovery
score used to order that queue, but they are not required to prove semantic
cohesion.

## Calibration result

`evaluate_discovery.py` reuses 80 labelled roots and 55 hard-negative or
unrelated roots from the versioned synthetic validation set. Version 1 measures:

- 760 same-topic and 6,800 different-topic root pairs;
- 80 positive and 9,200 negative root-to-centroid comparisons.

An absolute pair threshold of `0.940` produced 100% measured precision but only
1.3% recall. Centroid similarity alone could not achieve the requested 98%
precision on broad themes. This result rules out unsafe one-score automatic
publication. The production safeguards are the double semantic gate,
cluster-wide cohesion, author diversity and explicit review.

The set is synthetic silver data, not final evidence. Real reviewed Danaus
clusters must progressively form a gold set before thresholds are relaxed or
promotion is automated.

## Scheduling and scale

The Docker worker calls `refresh_opinion_topic_discovery(now())` at startup and
every 300 seconds. `DISCOVERY_REFRESH_INTERVAL_SECONDS` changes the operational
frequency. Each run processes at most 2,000 eligible roots and uses a partial
HNSW index over active candidate centroids.

Candidates and runs use RLS and are inaccessible to browser roles. The worker
can only execute the security-definer refresh function; it does not receive
direct candidate-table privileges.

## Controlled promotion

Promotion requires a qualified candidate and explicit editorial metadata:

```sql
select public.promote_opinion_topic_candidate(
  'CANDIDATE_UUID',
  'public-topic-slug',
  'Society',
  'Public topic title',
  'The open question shown to readers?',
  'Optional private review note'
);
```

The new active topic is queued for embedding. Once that embedding is ready, the
worker reclassifies existing messages and the normal trend engine determines
whether the topic is emerging, hot, declining or archived.

Rejecting a candidate is also explicit:

```sql
select public.reject_opinion_topic_candidate(
  'CANDIDATE_UUID',
  'Private reason for rejection'
);
```

These functions are restricted to `service_role`; a regular user cannot label,
orient, promote or reject a topic.

## DEV operations

Inspect classifier, trend and discovery state:

```bash
npm run opinion:dev:verify
```

Run the fully transactional discovery test:

```bash
npm run opinion:dev:test:discovery
```

Reproduce model calibration after rebuilding the worker image:

```bash
npm run opinion:evaluate:discovery
```

The smoke test fabricates coherent vectors, an exact duplicate and unrelated
noise. It verifies qualification, controlled promotion and expiry, then rolls
back every message, wallet, queue job, candidate and topic.
