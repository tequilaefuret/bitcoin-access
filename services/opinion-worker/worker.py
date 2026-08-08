import json
import logging
import os
import signal
import time
from pathlib import Path
from typing import Any

import numpy as np
import psycopg
from psycopg.rows import dict_row
from sentence_transformers import SentenceTransformer


QUEUE_NAME = "opinion_embeddings"
DATABASE_URL_ENV = os.environ.get("DATABASE_URL", "").strip()
DATABASE_URL_FILE = os.environ.get(
    "DATABASE_URL_FILE",
    "/run/secrets/opinion_database_url",
).strip()
MODEL_OVERRIDE = os.environ.get("EMBEDDING_MODEL", "").strip()
MODEL_PATH = os.environ.get("EMBEDDING_MODEL_PATH", "/opt/opinion-model").strip()
BATCH_SIZE = max(1, int(os.environ.get("BATCH_SIZE", "8")))
POLL_INTERVAL_SECONDS = max(0.25, float(os.environ.get("POLL_INTERVAL_SECONDS", "2")))
TREND_REFRESH_INTERVAL_SECONDS = max(
    60,
    int(os.environ.get("TREND_REFRESH_INTERVAL_SECONDS", "300")),
)
DISCOVERY_REFRESH_INTERVAL_SECONDS = max(
    60,
    int(os.environ.get("DISCOVERY_REFRESH_INTERVAL_SECONDS", "300")),
)
VISIBILITY_TIMEOUT_SECONDS = max(30, int(os.environ.get("VISIBILITY_TIMEOUT_SECONDS", "300")))
MAX_ATTEMPTS = max(1, int(os.environ.get("MAX_ATTEMPTS", "5")))
READY_FILE = Path("/tmp/opinion-worker.ready")

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
LOGGER = logging.getLogger("opinion-worker")
STOP_REQUESTED = False


def request_stop(signum: int, _frame: Any) -> None:
    global STOP_REQUESTED
    LOGGER.info("Stop requested by signal %s", signum)
    STOP_REQUESTED = True


def load_database_url() -> str:
    if DATABASE_URL_FILE:
        secret_path = Path(DATABASE_URL_FILE)
        if secret_path.is_file():
            secret_value = secret_path.read_text(encoding="utf-8").strip()
            if secret_value:
                return secret_value

    if DATABASE_URL_ENV:
        return DATABASE_URL_ENV

    raise RuntimeError(
        "Database URL is missing: mount DATABASE_URL_FILE or set DATABASE_URL"
    )


def connect() -> psycopg.Connection:
    return psycopg.connect(
        load_database_url(),
        autocommit=True,
        connect_timeout=15,
        row_factory=dict_row,
        application_name="danaus-opinion-worker",
    )


def load_database_model_name(connection: psycopg.Connection) -> str:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select embedding_model
            from public.opinion_classifier_settings
            where singleton = true
            """
        )
        row = cursor.fetchone()

    if not row:
        raise RuntimeError("Opinion classifier settings are missing")

    database_model = str(row["embedding_model"])
    if MODEL_OVERRIDE and MODEL_OVERRIDE != database_model:
        raise RuntimeError(
            "EMBEDDING_MODEL does not match opinion_classifier_settings: "
            f"{MODEL_OVERRIDE!r} != {database_model!r}"
        )

    return MODEL_OVERRIDE or database_model


def claim_jobs(connection: psycopg.Connection) -> list[dict[str, Any]]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select public.claim_opinion_embedding_jobs(%s, %s) as jobs
            """,
            (VISIBILITY_TIMEOUT_SECONDS, BATCH_SIZE),
        )
        row = cursor.fetchone()
        jobs = row["jobs"] if row else []
        return list(jobs or [])


def archive_job(connection: psycopg.Connection, message_id: int) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            "select public.archive_opinion_embedding_job(%s)",
            (message_id,),
        )


def parse_job(row: dict[str, Any]) -> dict[str, Any]:
    payload = row.get("message")
    if isinstance(payload, str):
        payload = json.loads(payload)
    if not isinstance(payload, dict):
        raise ValueError("Queue message must be a JSON object")

    return {
        "msg_id": int(row["msg_id"]),
        "read_ct": int(row.get("read_ct") or 1),
        **payload,
    }


def fetch_embedding_input(
    connection: psycopg.Connection,
    entity_type: str,
    entity_id: str,
) -> dict[str, Any] | None:
    with connection.cursor() as cursor:
        if entity_type == "message":
            cursor.execute(
                """
                select
                  %s::uuid as id,
                  embedding_input.input_text,
                  embedding_input.content_hash as current_hash,
                  embedding_input.root_message_id,
                  embedding_input.root_input_text,
                  embedding_input.parent_input_text,
                  embedding_input.target_input_text,
                  embedding.content_hash,
                  embedding.status,
                  embedding.model
                from public.get_opinion_message_embedding_input(%s)
                  as embedding_input
                join public.message_embeddings as embedding
                  on embedding.message_id = %s
                """,
                (entity_id, entity_id, entity_id),
            )
            row = cursor.fetchone()
            if not row:
                return None

            if row["root_input_text"]:
                if row["parent_input_text"]:
                    embedding_parts = [
                        (str(row["root_input_text"]), 0.60),
                        (str(row["parent_input_text"]), 0.15),
                        (str(row["target_input_text"]), 0.25),
                    ]
                else:
                    embedding_parts = [
                        (str(row["root_input_text"]), 0.70),
                        (str(row["target_input_text"]), 0.30),
                    ]
            else:
                embedding_parts = [(str(row["target_input_text"]), 1.0)]

            return {
                **row,
                "input": str(row["input_text"]),
                "embedding_parts": embedding_parts,
            }

        if entity_type == "topic":
            cursor.execute(
                """
                select
                  topic.id,
                  topic.category,
                  topic.title,
                  topic.question,
                  md5(concat_ws(E'\\n', topic.category, topic.title, topic.question)) as current_hash,
                  embedding.content_hash,
                  embedding.status,
                  embedding.model
                from public.opinion_topics as topic
                join public.opinion_topic_embeddings as embedding
                  on embedding.topic_id = topic.id
                where topic.id = %s
                  and topic.status = 'active'
                """,
                (entity_id,),
            )
            row = cursor.fetchone()
            if not row:
                return None

            return {
                **row,
                "input": (
                    "query: "
                    f"Category: {row['category']}\n"
                    f"Title: {row['title']}\n"
                    f"Question: {row['question']}"
                ),
            }

    raise ValueError(f"Unsupported entity_type: {entity_type!r}")


def mark_processing(
    connection: psycopg.Connection,
    entity_type: str,
    entity_id: str,
    content_hash: str,
    attempt_count: int,
) -> None:
    table_name = (
        "public.message_embeddings"
        if entity_type == "message"
        else "public.opinion_topic_embeddings"
    )
    id_column = "message_id" if entity_type == "message" else "topic_id"

    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            update {table_name}
            set
              status = 'processing',
              attempt_count = greatest(attempt_count, %s),
              last_error = null,
              updated_at = now()
            where {id_column} = %s
              and content_hash = %s
            """,
            (attempt_count, entity_id, content_hash),
        )


def vector_literal(values: Any) -> str:
    return "[" + ",".join(f"{float(value):.9g}" for value in values) + "]"


def save_embedding(
    connection: psycopg.Connection,
    entity_type: str,
    entity_id: str,
    content_hash: str,
    model_name: str,
    embedding: Any,
) -> bool:
    table_name = (
        "public.message_embeddings"
        if entity_type == "message"
        else "public.opinion_topic_embeddings"
    )
    id_column = "message_id" if entity_type == "message" else "topic_id"

    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            update {table_name}
            set
              embedding = %s::extensions.vector,
              model = %s,
              status = 'ready',
              last_error = null,
              updated_at = now()
            where {id_column} = %s
              and content_hash = %s
            returning {id_column}
            """,
            (vector_literal(embedding), model_name, entity_id, content_hash),
        )
        return cursor.fetchone() is not None


def classify_message(connection: psycopg.Connection, message_id: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            "select public.classify_opinion_message(%s)",
            (message_id,),
        )


def reclassify_all(connection: psycopg.Connection) -> int:
    with connection.cursor() as cursor:
        cursor.execute("select public.reclassify_all_opinion_messages() as count")
        row = cursor.fetchone()
        return int(row["count"] if row else 0)


def refresh_trends(connection: psycopg.Connection) -> dict[str, Any]:
    with connection.cursor() as cursor:
        cursor.execute("select public.refresh_opinion_trends(now()) as result")
        row = cursor.fetchone()
        return dict(row["result"] if row and row["result"] else {})


def refresh_topic_discovery(connection: psycopg.Connection) -> dict[str, Any]:
    with connection.cursor() as cursor:
        cursor.execute(
            "select public.refresh_opinion_topic_discovery(now()) as result"
        )
        row = cursor.fetchone()
        return dict(row["result"] if row and row["result"] else {})


def mark_failure(
    connection: psycopg.Connection,
    job: dict[str, Any],
    error: Exception,
) -> None:
    entity_type = job.get("entity_type")
    entity_id = job.get("entity_id")
    read_count = int(job.get("read_ct") or 1)
    error_message = str(error)[:2000]

    if entity_type in {"message", "topic"} and entity_id:
        table_name = (
            "public.message_embeddings"
            if entity_type == "message"
            else "public.opinion_topic_embeddings"
        )
        id_column = "message_id" if entity_type == "message" else "topic_id"
        next_status = "error" if read_count >= MAX_ATTEMPTS else "pending"

        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                update {table_name}
                set
                  status = %s,
                  attempt_count = greatest(attempt_count, %s),
                  last_error = %s,
                  updated_at = now()
                where {id_column} = %s
                """,
                (next_status, read_count, error_message, entity_id),
            )

    if read_count >= MAX_ATTEMPTS:
        archive_job(connection, int(job["msg_id"]))
        LOGGER.error(
            "Job %s archived after %s attempts: %s",
            job.get("msg_id"),
            read_count,
            error_message,
        )
    else:
        LOGGER.warning(
            "Job %s failed on attempt %s and will become visible again: %s",
            job.get("msg_id"),
            read_count,
            error_message,
        )


def process_jobs(
    connection: psycopg.Connection,
    model: SentenceTransformer,
    model_name: str,
    claimed_rows: list[dict[str, Any]],
) -> None:
    embedding_jobs: list[tuple[dict[str, Any], dict[str, Any]]] = []

    for raw_row in claimed_rows:
        try:
            job = parse_job(raw_row)

            if job.get("action") == "reclassify_all":
                count = reclassify_all(connection)
                archive_job(connection, job["msg_id"])
                LOGGER.info("Reclassified %s ready messages", count)
                continue

            if job.get("action") != "embed":
                raise ValueError(f"Unsupported action: {job.get('action')!r}")

            entity_type = str(job.get("entity_type") or "")
            entity_id = str(job.get("entity_id") or "")
            content_hash = str(job.get("content_hash") or "")
            if entity_type not in {"message", "topic"} or not entity_id or not content_hash:
                raise ValueError("Embedding job is missing required fields")

            source = fetch_embedding_input(connection, entity_type, entity_id)
            if not source:
                archive_job(connection, job["msg_id"])
                LOGGER.info("Archived stale job %s for missing %s", job["msg_id"], entity_id)
                continue

            if source["current_hash"] != content_hash or source["content_hash"] != content_hash:
                archive_job(connection, job["msg_id"])
                LOGGER.info("Archived stale job %s after content changed", job["msg_id"])
                continue

            if source["status"] == "ready" and source["model"] == model_name:
                if entity_type == "message":
                    classify_message(connection, entity_id)
                else:
                    reclassify_all(connection)
                archive_job(connection, job["msg_id"])
                continue

            mark_processing(
                connection,
                entity_type,
                entity_id,
                content_hash,
                job["read_ct"],
            )
            embedding_jobs.append((job, source))
        except Exception as error:  # Keep one malformed job from blocking the batch.
            fallback_job = {
                "msg_id": int(raw_row["msg_id"]),
                "read_ct": int(raw_row.get("read_ct") or 1),
            }
            try:
                fallback_job.update(parse_job(raw_row))
            except Exception:
                pass
            mark_failure(connection, fallback_job, error)

    if not embedding_jobs:
        return

    try:
        flat_inputs: list[str] = []
        part_ranges: list[tuple[int, int, list[float]]] = []
        for _job, source in embedding_jobs:
            parts = source.get("embedding_parts") or [(source["input"], 1.0)]
            start_index = len(flat_inputs)
            flat_inputs.extend(part_text for part_text, _weight in parts)
            part_ranges.append(
                (
                    start_index,
                    len(parts),
                    [float(weight) for _part_text, weight in parts],
                )
            )

        part_embeddings = model.encode(
            flat_inputs,
            batch_size=BATCH_SIZE,
            normalize_embeddings=True,
            show_progress_bar=False,
            convert_to_numpy=True,
        )

        embeddings = []
        for start_index, part_count, weights in part_ranges:
            combined = np.zeros_like(part_embeddings[start_index])
            for offset, weight in enumerate(weights):
                combined += part_embeddings[start_index + offset] * weight
            norm = float(np.linalg.norm(combined))
            if norm == 0:
                raise ValueError("Combined embedding has a zero norm")
            embeddings.append(combined / norm)
    except Exception as error:
        for job, _source in embedding_jobs:
            mark_failure(connection, job, error)
        return

    for (job, _source), embedding in zip(embedding_jobs, embeddings):
        try:
            saved = save_embedding(
                connection,
                job["entity_type"],
                job["entity_id"],
                job["content_hash"],
                model_name,
                embedding,
            )
            if not saved:
                archive_job(connection, job["msg_id"])
                LOGGER.info("Archived stale job %s during save", job["msg_id"])
                continue

            if job["entity_type"] == "message":
                classify_message(connection, job["entity_id"])
            else:
                reclassify_all(connection)

            archive_job(connection, job["msg_id"])
            LOGGER.info(
                "Embedded and archived job %s for %s %s",
                job["msg_id"],
                job["entity_type"],
                job["entity_id"],
            )
        except Exception as error:
            mark_failure(connection, job, error)


def run() -> None:
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    connection = connect()
    model_name = load_database_model_name(connection)
    LOGGER.info("Loading local embedding model %s", model_name)
    model = SentenceTransformer(MODEL_PATH, device="cpu", local_files_only=True)
    READY_FILE.touch()
    LOGGER.info("Opinion worker ready; queue=%s batch_size=%s", QUEUE_NAME, BATCH_SIZE)
    next_trend_refresh_at = 0.0
    next_discovery_refresh_at = 0.0

    while not STOP_REQUESTED:
        try:
            if connection.closed:
                connection = connect()

            if time.monotonic() >= next_discovery_refresh_at:
                discovery_result = refresh_topic_discovery(connection)
                next_discovery_refresh_at = (
                    time.monotonic() + DISCOVERY_REFRESH_INTERVAL_SECONDS
                )
                LOGGER.info("Opinion topic discovery refreshed: %s", discovery_result)

            if time.monotonic() >= next_trend_refresh_at:
                trend_result = refresh_trends(connection)
                next_trend_refresh_at = (
                    time.monotonic() + TREND_REFRESH_INTERVAL_SECONDS
                )
                LOGGER.info("Opinion trends refreshed: %s", trend_result)

            jobs = claim_jobs(connection)
            if jobs:
                process_jobs(connection, model, model_name, jobs)
            else:
                time.sleep(POLL_INTERVAL_SECONDS)
        except psycopg.Error as error:
            LOGGER.exception("Database operation failed: %s", error)
            try:
                connection.close()
            except Exception:
                pass
            time.sleep(min(10, POLL_INTERVAL_SECONDS * 2))
            connection = connect()

    READY_FILE.unlink(missing_ok=True)
    connection.close()
    LOGGER.info("Opinion worker stopped")


if __name__ == "__main__":
    run()
