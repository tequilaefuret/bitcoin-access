#!/usr/bin/env python3
"""Calibrate root-post clustering for automatic Opinion topic discovery."""

import argparse
import json
import os
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer

from dataset import HARD_NEGATIVES, SINGLE_TOPIC_STATEMENTS, UNRELATED_STATEMENTS


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model-path",
        default=os.environ.get("EMBEDDING_MODEL_PATH", "/opt/opinion-model"),
    )
    parser.add_argument("--target-precision", type=float, default=0.98)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def publication_input(text: str) -> str:
    return f"passage: Publication:\n{text}"


def normalize(vector: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vector))
    if norm == 0:
        raise ValueError("Cannot normalize a zero vector")
    return vector / norm


def metrics(
    positive_scores: np.ndarray,
    negative_scores: np.ndarray,
    threshold: float,
) -> dict[str, float | int]:
    true_positive = int(np.sum(positive_scores >= threshold))
    false_negative = int(np.sum(positive_scores < threshold))
    false_positive = int(np.sum(negative_scores >= threshold))
    true_negative = int(np.sum(negative_scores < threshold))
    precision = true_positive / max(true_positive + false_positive, 1)
    recall = true_positive / max(true_positive + false_negative, 1)
    return {
        "threshold": round(threshold, 3),
        "precision": precision,
        "recall": recall,
        "true_positive": true_positive,
        "false_positive": false_positive,
        "true_negative": true_negative,
        "false_negative": false_negative,
    }


def select_threshold(
    positive_scores: np.ndarray,
    negative_scores: np.ndarray,
    target_precision: float,
) -> dict[str, float | int]:
    candidates = [
        metrics(positive_scores, negative_scores, float(threshold))
        for threshold in np.arange(0.70, 0.951, 0.001)
    ]
    eligible = [
        candidate
        for candidate in candidates
        if float(candidate["precision"]) >= target_precision
    ]
    if not eligible:
        selected = max(candidates, key=lambda item: float(item["precision"]))
        return {**selected, "target_precision_met": False}
    selected = max(
        eligible,
        key=lambda item: (float(item["recall"]), -float(item["threshold"])),
    )
    return {**selected, "target_precision_met": True}


def percentile_summary(scores: np.ndarray) -> dict[str, float]:
    return {
        "min": float(np.min(scores)),
        "p05": float(np.percentile(scores, 5)),
        "median": float(np.median(scores)),
        "p95": float(np.percentile(scores, 95)),
        "max": float(np.max(scores)),
    }


def main() -> None:
    args = parse_args()
    model = SentenceTransformer(args.model_path, device="cpu", local_files_only=True)

    labelled: list[tuple[str, str]] = [
        (topic_slug, text)
        for topic_slug, statements in SINGLE_TOPIC_STATEMENTS.items()
        for text in statements
    ]
    noise = [*HARD_NEGATIVES, *UNRELATED_STATEMENTS]
    all_texts = [text for _topic, text in labelled] + noise
    vectors = model.encode(
        [publication_input(text) for text in all_texts],
        batch_size=32,
        normalize_embeddings=True,
        show_progress_bar=True,
        convert_to_numpy=True,
    )

    labelled_vectors = vectors[: len(labelled)]
    noise_vectors = vectors[len(labelled) :]
    pair_positive: list[float] = []
    pair_negative: list[float] = []
    for left_index, (left_topic, _left_text) in enumerate(labelled):
        for right_index in range(left_index + 1, len(labelled)):
            right_topic = labelled[right_index][0]
            score = float(labelled_vectors[left_index] @ labelled_vectors[right_index])
            if left_topic == right_topic:
                pair_positive.append(score)
            else:
                pair_negative.append(score)
        pair_negative.extend(
            float(score) for score in labelled_vectors[left_index] @ noise_vectors.T
        )

    centroid_positive: list[float] = []
    centroid_negative: list[float] = []
    for topic_slug in SINGLE_TOPIC_STATEMENTS:
        topic_indexes = [
            index for index, (label, _text) in enumerate(labelled) if label == topic_slug
        ]
        other_indexes = [
            index for index, (label, _text) in enumerate(labelled) if label != topic_slug
        ]
        for held_out_index in topic_indexes:
            training_indexes = [
                index for index in topic_indexes if index != held_out_index
            ]
            centroid = normalize(np.mean(labelled_vectors[training_indexes], axis=0))
            centroid_positive.append(
                float(labelled_vectors[held_out_index] @ centroid)
            )
            centroid_negative.extend(
                float(score) for score in labelled_vectors[other_indexes] @ centroid
            )
            centroid_negative.extend(float(score) for score in noise_vectors @ centroid)

    pair_positive_array = np.asarray(pair_positive)
    pair_negative_array = np.asarray(pair_negative)
    centroid_positive_array = np.asarray(centroid_positive)
    centroid_negative_array = np.asarray(centroid_negative)
    report = {
        "dataset": {
            "annotation_status": "synthetic_silver",
            "known_topic_count": len(SINGLE_TOPIC_STATEMENTS),
            "labelled_root_count": len(labelled),
            "noise_root_count": len(noise),
            "pair_positive_count": len(pair_positive),
            "pair_negative_count": len(pair_negative),
            "centroid_positive_count": len(centroid_positive),
            "centroid_negative_count": len(centroid_negative),
        },
        "target_precision": args.target_precision,
        "pair_calibration": {
            "selected": select_threshold(
                pair_positive_array,
                pair_negative_array,
                args.target_precision,
            ),
            "positive_scores": percentile_summary(pair_positive_array),
            "negative_scores": percentile_summary(pair_negative_array),
        },
        "centroid_calibration": {
            "selected": select_threshold(
                centroid_positive_array,
                centroid_negative_array,
                args.target_precision,
            ),
            "positive_scores": percentile_summary(centroid_positive_array),
            "negative_scores": percentile_summary(centroid_negative_array),
        },
    }
    rendered = json.dumps(report, indent=2, ensure_ascii=False)
    print(rendered)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
