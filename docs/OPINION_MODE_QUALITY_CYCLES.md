# Opinion quality, cycles and validation

Migration `202608040002_opinion_quality_cycles_multilabel.sql` is the current
foundation for selecting publications in Opinion mode.

## Product invariants

- Topic relevance is produced only by the local model.
- Authors, readers and moderators cannot assign or correct a publication's
  orientation.
- No orientation label is returned to the browser.
- A reader's private stance is stored separately and never affects selection.
- Uncertain content remains outside Opinion mode.
- Reposts and `content_origin = 'test'` are excluded from Opinion measurements.

## Contextual comments

The database reconstructs a comment's ancestry before queuing an embedding. A
broken, deleted or test ancestry excludes the comment.

The worker combines normalized vectors as follows:

- root publication: `100%` own text;
- direct comment: `70%` root and `30%` comment;
- nested comment: `60%` root, `15%` immediate parent and `25%` comment.

Editing a root invalidates and requeues all descendants because their semantic
context changed.

## Multi-topic classification

Every active topic is scored independently. A publication can therefore belong
to several subjects. Each topic has an internal cosine threshold in
`opinion_topic_classifier_settings`; there is no best-versus-second margin
rejection.

The four pilot thresholds were measured on validation set v1:

| Topic | Threshold |
| --- | ---: |
| Inflation and savings | `0.854` |
| Remote work and productivity | `0.844` |
| Nuclear power | `0.852` |
| AI regulation | `0.847` |

The fallback for a new, uncalibrated topic is `0.85`.

## Hermetic cycles

`opinion_topic_cycles` divides recurring subjects into separate episodes. An
Opinion candidate is eligible only when both the publication and its root were
created inside the current open cycle. An old nuclear-power thread therefore
cannot reappear when a later nuclear-power cycle opens.

Stage 3 trend detection calls `open_opinion_topic_cycle` when a subject
genuinely re-emerges. Opening one cycle atomically closes the previous cycle.

## Exposure definition

An exposure is counted when the backend returns a loaded message, not when a
viewport observer confirms visibility. IDs are deduplicated inside one response,
but a later reload counts again.

Classic exposures are recorded only after the read cost has been debited.
Opinion exposures are recorded after the response selection is assembled. Only
aggregate counts per cycle and message are stored; there is no reader-level
exposure history.

## Quality score

Shell balance never enters the formula. One `Useful` always has the same weight.

```text
Q = 0.70 * UsefulWilson
  + 0.20 * ReplyWilson
  + 0.10 * ReplyBreadth
```

- `UsefulWilson` is the one-sided 80% Wilson lower bound for direct Useful
  signals divided by message exposures.
- `ReplyWilson` applies the same correction to Useful signals received by
  direct replies divided by reply exposures.
- `ReplyBreadth = min(1, ln(1 + distinct reply authors) / ln(6))`; it saturates
  at five distinct authors.
- `max(exposures, useful)` is used as the denominator during the transition from
  historical data so successes can never exceed trials.

Wilson correction prevents a publication with one exposure and one Useful from
immediately outranking content supported by a larger sample. Time decay is not
part of `Q`; cycle boundaries provide recency without mixing separate episodes.

## Validation set v1

The local evaluator contains 800 deterministic synthetic silver cases:

- 320 clear single-topic publications;
- 160 context-dependent comments;
- 120 lexical hard negatives;
- 100 multi-topic publications;
- 100 unrelated publications.

Calibrated per-topic thresholds currently produce `92.5%` micro-precision,
`35.8%` micro-recall and no false positive on the unrelated/hard-negative
groups. The lower recall is deliberate for the conservative MVP.

Run the structural and model checks with the commands documented in
`services/opinion-worker/evaluation/README.md`. This synthetic set must be
supplemented with a human-reviewed gold set before full automation.

## DEV verification

The repository contains three explicit operational scripts:

- `scripts/mark-dev-opinion-babble-as-test.sql`: one-time guarded DEV cleanup;
- `scripts/verify-opinion-dev.sql`: read-only state checks;
- `scripts/test-opinion-quality-dev.sql`: end-to-end smoke test inside a rolled
  back transaction.
