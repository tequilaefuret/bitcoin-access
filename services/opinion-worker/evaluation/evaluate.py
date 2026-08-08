#!/usr/bin/env python3
"""Evaluate the local embedding model against the synthetic Opinion dataset."""

import argparse
import json
import os
from collections import defaultdict
from pathlib import Path
from typing import Iterable

import numpy as np
from sentence_transformers import SentenceTransformer

from dataset import TOPICS, VALIDATION_CASES


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model-path",
        default=os.environ.get("EMBEDDING_MODEL_PATH", "/opt/opinion-model"),
    )
    parser.add_argument("--threshold", type=float, default=0.85)
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional path for the complete JSON report.",
    )
    return parser.parse_args()


def topic_input(topic: dict[str, str]) -> str:
    return (
        "query: "
        f"Category: {topic['category']}\n"
        f"Title: {topic['title']}\n"
        f"Question: {topic['question']}"
    )


def safe_ratio(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0


def calculate_metrics(
    scores: np.ndarray,
    threshold: float | dict[str, float],
    topic_slugs: list[str],
) -> dict[str, object]:
    true_positive = 0
    false_positive = 0
    false_negative = 0
    exact_matches = 0
    predicted_cases = 0
    empty_case_count = 0
    empty_false_positives = 0
    group_totals: dict[str, int] = defaultdict(int)
    group_exact: dict[str, int] = defaultdict(int)
    per_topic = {
        slug: {"true_positive": 0, "false_positive": 0, "false_negative": 0}
        for slug in topic_slugs
    }

    for case_index, case in enumerate(VALIDATION_CASES):
        expected = set(case.expected_topics)
        predicted = {
            topic_slugs[topic_index]
            for topic_index, score in enumerate(scores[case_index])
            if score >= (
                threshold[topic_slugs[topic_index]]
                if isinstance(threshold, dict)
                else threshold
            )
        }
        if predicted:
            predicted_cases += 1
        if not expected:
            empty_case_count += 1
            if predicted:
                empty_false_positives += 1

        case_tp = len(expected & predicted)
        case_fp = len(predicted - expected)
        case_fn = len(expected - predicted)
        true_positive += case_tp
        false_positive += case_fp
        false_negative += case_fn

        group = (
            "single"
            if case.group.startswith("single-")
            else "multi"
            if case.group.startswith("multi-")
            else case.group
        )
        group_totals[group] += 1
        if expected == predicted:
            exact_matches += 1
            group_exact[group] += 1

        for slug in topic_slugs:
            if slug in expected and slug in predicted:
                per_topic[slug]["true_positive"] += 1
            elif slug in predicted:
                per_topic[slug]["false_positive"] += 1
            elif slug in expected:
                per_topic[slug]["false_negative"] += 1

    precision = safe_ratio(true_positive, true_positive + false_positive)
    recall = safe_ratio(true_positive, true_positive + false_negative)
    f1 = safe_ratio(2 * precision * recall, precision + recall)

    for values in per_topic.values():
        topic_precision = safe_ratio(
            values["true_positive"],
            values["true_positive"] + values["false_positive"],
        )
        topic_recall = safe_ratio(
            values["true_positive"],
            values["true_positive"] + values["false_negative"],
        )
        values["precision"] = topic_precision
        values["recall"] = topic_recall
        values["f1"] = safe_ratio(
            2 * topic_precision * topic_recall,
            topic_precision + topic_recall,
        )

    return {
        "threshold": threshold,
        "micro_precision": precision,
        "micro_recall": recall,
        "micro_f1": f1,
        "exact_match_rate": safe_ratio(exact_matches, len(VALIDATION_CASES)),
        "prediction_coverage": safe_ratio(predicted_cases, len(VALIDATION_CASES)),
        "negative_false_positive_rate": safe_ratio(
            empty_false_positives,
            empty_case_count,
        ),
        "counts": {
            "cases": len(VALIDATION_CASES),
            "true_positive": true_positive,
            "false_positive": false_positive,
            "false_negative": false_negative,
        },
        "exact_match_by_group": {
            group: safe_ratio(group_exact[group], total)
            for group, total in sorted(group_totals.items())
        },
        "per_topic": per_topic,
    }


def threshold_sweep(
    scores: np.ndarray,
    topic_slugs: list[str],
) -> list[dict[str, object]]:
    return [
        calculate_metrics(scores, round(float(threshold), 2), topic_slugs)
        for threshold in np.arange(0.50, 0.851, 0.01)
    ]


def calibrate_topic_thresholds(
    scores: np.ndarray,
    topic_slugs: list[str],
    target_precision: float = 0.90,
) -> dict[str, float]:
    thresholds: dict[str, float] = {}
    candidates = np.arange(0.80, 0.901, 0.001)

    for topic_index, topic_slug in enumerate(topic_slugs):
        expected = np.asarray(
            [topic_slug in case.expected_topics for case in VALIDATION_CASES]
        )
        best_threshold = float(candidates[-1])
        best_recall = -1.0

        for candidate in candidates:
            predicted = scores[:, topic_index] >= candidate
            true_positive = int(np.sum(predicted & expected))
            false_positive = int(np.sum(predicted & ~expected))
            false_negative = int(np.sum(~predicted & expected))
            precision = safe_ratio(
                true_positive,
                true_positive + false_positive,
            )
            recall = safe_ratio(
                true_positive,
                true_positive + false_negative,
            )
            if precision >= target_precision and recall > best_recall:
                best_threshold = float(candidate)
                best_recall = recall

        thresholds[topic_slug] = round(best_threshold, 3)

    return thresholds


def compact_metrics(metrics: dict[str, object]) -> dict[str, object]:
    keys: Iterable[str] = (
        "threshold",
        "micro_precision",
        "micro_recall",
        "micro_f1",
        "exact_match_rate",
        "prediction_coverage",
        "negative_false_positive_rate",
    )
    return {key: metrics[key] for key in keys}


def encode_cases(
    model: SentenceTransformer,
) -> np.ndarray:
    flat_inputs: list[str] = []
    part_ranges: list[tuple[int, int, list[float]]] = []
    for case in VALIDATION_CASES:
        start_index = len(flat_inputs)
        flat_inputs.extend(text for text, _weight in case.embedding_parts)
        part_ranges.append(
            (
                start_index,
                len(case.embedding_parts),
                [weight for _text, weight in case.embedding_parts],
            )
        )

    part_vectors = model.encode(
        flat_inputs,
        batch_size=32,
        normalize_embeddings=True,
        show_progress_bar=True,
        convert_to_numpy=True,
    )
    case_vectors = []
    for start_index, part_count, weights in part_ranges:
        combined = np.zeros_like(part_vectors[start_index])
        for offset, weight in enumerate(weights):
            combined += part_vectors[start_index + offset] * weight
        case_vectors.append(combined / np.linalg.norm(combined))

    return np.asarray(case_vectors)


def main() -> None:
    args = parse_args()
    topic_slugs = list(TOPICS)
    model = SentenceTransformer(args.model_path, device="cpu")
    topic_vectors = model.encode(
        [topic_input(TOPICS[slug]) for slug in topic_slugs],
        normalize_embeddings=True,
        show_progress_bar=False,
        convert_to_numpy=True,
    )
    case_vectors = encode_cases(model)
    scores = case_vectors @ topic_vectors.T

    selected = calculate_metrics(scores, args.threshold, topic_slugs)
    sweep = threshold_sweep(scores, topic_slugs)
    best_f1 = max(sweep, key=lambda item: float(item["micro_f1"]))
    precision_candidates = [
        item for item in sweep if float(item["micro_precision"]) >= 0.90
    ]
    best_high_precision = (
        max(precision_candidates, key=lambda item: float(item["micro_recall"]))
        if precision_candidates
        else None
    )
    calibrated_thresholds = calibrate_topic_thresholds(scores, topic_slugs)
    calibrated_metrics = calculate_metrics(
        scores,
        calibrated_thresholds,
        topic_slugs,
    )

    report = {
        "dataset": {
            "version": 1,
            "annotation_status": "synthetic_silver",
            "case_count": len(VALIDATION_CASES),
        },
        "model_path": args.model_path,
        "selected_threshold": selected,
        "best_micro_f1": compact_metrics(best_f1),
        "best_recall_at_90_percent_precision": (
            compact_metrics(best_high_precision) if best_high_precision else None
        ),
        "per_topic_90_percent_precision": calibrated_metrics,
        "threshold_sweep": [compact_metrics(item) for item in sweep],
    }
    rendered = json.dumps(report, indent=2, ensure_ascii=False)
    print(rendered)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
