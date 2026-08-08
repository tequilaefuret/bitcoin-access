# Opinion semantic validation

This directory contains a deterministic, versioned validation set that never
enters the application database and never spends shells.

Version 1 contains 800 synthetic silver cases:

- 320 clear single-topic publications;
- 160 context-dependent comments;
- 120 lexical hard negatives;
- 100 multi-topic publications;
- 100 unrelated or noisy publications.

Run the structural tests:

```bash
npm run opinion:test:dataset
```

Run the local model evaluation from the worker image:

```bash
npm run opinion:evaluate
```

Calibrate root-post clustering independently from known-topic classification:

```bash
npm run opinion:evaluate:discovery
```

The discovery evaluator measures both root-to-root and root-to-centroid
similarities. Its first report contains 760 positive and 6,800 negative pairs,
plus 9,280 centroid comparisons. It demonstrates that an embedding threshold
alone is not safe enough for automatic publication: a 0.940 pair threshold
reaches 100% measured precision but only 1.3% recall. Production therefore uses
two semantic gates, cluster-wide cohesion, independent authors and controlled
promotion.

The evaluator reports the configured threshold, the best global F1 threshold,
the best recall that retains at least 90% precision, per-topic metrics and the
false-positive rate on unrelated content. Synthetic data is suitable for
regression detection and initial calibration. Before full automation, a
representative subset must be reviewed by humans and promoted to a separate
gold dataset.

Version 1 uses `0.85` as its conservative fallback. The four pilot topics use
independently measured thresholds between `0.844` and `0.854`, producing 92.5%
micro-precision on this synthetic set. The previous `0.72` accepted nearly
every case because multilingual E5 cosine similarities have a high baseline;
it must not be restored without a new measured validation run.
