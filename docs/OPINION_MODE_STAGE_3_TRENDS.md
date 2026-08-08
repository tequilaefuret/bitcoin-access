# Opinion mode - Stage 3 trend detection

Migration `202608050001_opinion_trend_detection.sql` detects topic momentum on
four rolling windows without a paid API: `1h`, `6h`, `24h` and `7d`.

## Scheduling

The Opinion Docker worker calls `refresh_opinion_trends(now())` at startup and
every 300 seconds. Change `TREND_REFRESH_INTERVAL_SECONDS` only for operational
reasons; the database formula itself remains unchanged.

No Supabase cron extension or external scheduler is required. Queue processing
and trend calculation use the same restricted `danaus_opinion_worker` role.

## Eligible activity

Only messages already accepted by the semantic topic classifier can contribute.
The calculation excludes:

- deleted content;
- `content_origin = 'test'`;
- reposts;
- messages whose root belongs to another hermetic cycle;
- exact duplicates after lowercasing, trimming and whitespace normalization.

For comments, the duplicate key also contains the root message ID. The same
short sentence under two unrelated discussions is therefore not incorrectly
collapsed. Semantic near-duplicate detection remains a later improvement; the
current stage handles explicit reposts and exact normalized duplicates.

## Signals

Each window measures:

- distinct publication authors;
- distinct root discussions;
- deduplicated messages and comments;
- distinct wallets that spent a shell on `Useful`;
- total Useful events for diagnostics;
- the same metrics in the immediately preceding window;
- the ratio between current and previous scores.

Shell balance and exposure volume never enter the trend score. Every author and
every Useful voter has the same weight.

## Comparable window score

Each count is transformed into a saturating component so a very large account
or burst cannot make the score grow without limit:

```text
Trend = 100 * (
    0.35 * (1 - exp(-authors / targetAuthors))
  + 0.20 * (1 - exp(-roots / targetRoots))
  + 0.15 * (1 - exp(-messages / targetMessages))
  + 0.30 * (1 - exp(-voters / targetVoters))
)
```

The result is between `0` and `100`. Targets increase with the window length,
which makes a `1h` score comparable with a `7d` score instead of automatically
favoring the longest period.

## Hot gates

A score alone cannot make a topic hot. It must contain enough distinct roots and
messages, plus either enough authors or enough Useful voters:

| Window | Authors | Roots | Messages | Useful voters |
| --- | ---: | ---: | ---: | ---: |
| `1h` | 3 | 2 | 4 | 5 |
| `6h` | 5 | 3 | 7 | 10 |
| `24h` | 8 | 4 | 12 | 20 |
| `7d` | 15 | 6 | 20 | 40 |

This protects the feed from one prolific account while allowing the silent
majority to confirm that a subject matters through paid Useful signals.

## Ordering

The backend selects the shortest qualifying hot window. Opinion topics are then
ordered as follows:

1. `hot · 1h`, then `hot · 6h`, `hot · 24h`, `hot · 7d`;
2. emerging topics using the same window order;
3. declining topics;
4. archived topics are not returned.

Inside one group, the trend score, acceleration ratio and editorial `sort_rank`
act as successive tie-breakers. Detailed counts and scores remain private; the
browser receives only the lifecycle state and dominant window.

## Lifecycle and cycles

- `emerging`: activity exists but has not passed a hot gate.
- `hot`: one of the four windows passes its gate.
- `declining`: a previously hot topic still has seven-day activity but no longer
  passes a hot gate.
- `archived`: no activity remains in the seven-day window.

Newly created empty cycles receive a seven-day grace period. When an archived
topic receives a genuinely new root publication, the trend engine opens a new
cycle at that root's creation time. Old threads cannot enter the new episode.

## DEV operations

Run the read-only verification:

```bash
npm run opinion:dev:verify
```

Run the complete transactional trend test:

```bash
npm run opinion:dev:test:trends
```

The test creates a controlled spike, duplicate and repost, checks the `hot 1h`
state, advances time to `declining`, advances again to `archived`, then rolls
back every inserted row and queue job.
