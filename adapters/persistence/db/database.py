"""Persistence helpers for runs, artifacts, webhooks, and DLQ."""
from __future__ import annotations

import json
import logging
from collections.abc import Mapping, Sequence
from typing import Any
from datetime import datetime, timezone, timedelta

import psycopg
from psycopg import errors
from psycopg.rows import dict_row

logger = logging.getLogger("myloware.api.storage")


class Database:
    def __init__(self, dsn: str) -> None:
        self._dsn = self._normalize_dsn(dsn)

    def _connect(self) -> psycopg.Connection:
        return psycopg.connect(self._dsn, autocommit=True, row_factory=dict_row)

    def create_run(
        self,
        *,
        run_id: str,
        project: str,
        status: str,
        payload: Mapping[str, object],
    ) -> None:
        """Create a run record (idempotent)."""
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO runs (run_id, project, status, payload)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (run_id) DO NOTHING;
                """,
                (run_id, project, status, json.dumps(payload)),
            )

    def update_run(self, *, run_id: str, status: str, result: Mapping[str, object] | None = None) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE runs
                SET status = %s,
                    result = %s,
                    updated_at = NOW()
                WHERE run_id = %s;
                """,
                (status, json.dumps(result or {}), run_id),
            )

    def get_run(self, run_id: str) -> Mapping[str, object] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM runs WHERE run_id = %s", (run_id,)).fetchone()
            return row

    def list_artifacts(self, run_id: str) -> list[Mapping[str, object]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, type, url, provider, checksum, metadata, created_at, persona
                FROM artifacts
                WHERE run_id = %s
                ORDER BY created_at ASC;
                """,
                (run_id,),
            ).fetchall()
            return list(rows)

    def list_webhook_events(
        self,
        *,
        providers: Sequence[str] | None = None,
        limit: int = 50,
    ) -> list[Mapping[str, object]]:
        if limit <= 0:
            raise ValueError("limit must be positive")
        where_clause = ""
        params: list[Any] = []
        if providers:
            where_clause = "WHERE provider = ANY(%s)"
            params.append(list(providers))
        params.append(limit)
        query = f"""
            SELECT
                id::text AS id,
                idempotency_key,
                provider,
                headers,
                payload,
                signature_status,
                received_at
            FROM webhook_events
            {where_clause}
            ORDER BY received_at DESC
            LIMIT %s;
        """
        with self._connect() as conn:
            rows = conn.execute(query, tuple(params)).fetchall()
        normalized: list[dict[str, Any]] = []
        for row in rows:
            record = dict(row)
            payload = record.get("payload")
            if isinstance(payload, memoryview):
                record["payload"] = payload.tobytes()
            normalized.append(record)
        return normalized

    def create_artifact(
        self,
        *,
        run_id: str,
        artifact_type: str,
        url: str | None,
        provider: str,
        checksum: str | None,
        metadata: Mapping[str, object],
        persona: str | None = None,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO artifacts (run_id, type, url, provider, checksum, metadata, persona)
                VALUES (%s, %s, %s, %s, %s, %s, %s);
                """,
                (run_id, artifact_type, url, provider, checksum, json.dumps(metadata), persona),
            )

    def record_hitl_approval(
        self,
        *,
        run_id: str,
        gate: str,
        approver_ip: str | None = None,
        approver: str | None = None,
        metadata: Mapping[str, object] | None = None,
    ) -> None:
        """Record a HITL approval event. Persisted as an artifact for auditability."""
        meta: dict[str, object] = {"gate": gate}
        if approver_ip:
            meta["ip"] = approver_ip
        if approver:
            meta["approver"] = approver
        if metadata:
            meta.update(dict(metadata))
        self.create_artifact(
            run_id=run_id,
            artifact_type="hitl.approval",
            url=None,
            provider="api",
            checksum=None,
            metadata=meta,
        )
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO hitl_approvals (run_id, gate, approver_ip, approver, metadata)
                VALUES (%s, %s, %s, %s, %s);
                """,
                (run_id, gate, approver_ip, approver, json.dumps(meta)),
            )

    def record_webhook_event(
        self,
        *,
        idempotency_key: str,
        provider: str,
        headers: Mapping[str, str],
        payload: bytes,
        signature_status: str,
        ttl_seconds: int = 86_400,
    ) -> bool:
        """Store webhook payloads; returns False if duplicate."""
        with self._connect() as conn:
            stored = False
            try:
                conn.execute(
                    """
                    INSERT INTO webhook_events (idempotency_key, provider, headers, payload, signature_status)
                    VALUES (%s, %s, %s, %s, %s);
                    """,
                    (idempotency_key, provider, json.dumps(dict(headers)), payload, signature_status),
                )
                stored = True
            except errors.UniqueViolation:
                logger.info("Duplicate webhook suppressed", extra={"key": idempotency_key})
            finally:
                if ttl_seconds > 0:
                    try:
                        conn.execute(
                            """
                            DELETE FROM webhook_events
                            WHERE received_at < NOW() - (%s * INTERVAL '1 second');
                            """,
                            (ttl_seconds,),
                        )
                    except Exception as exc:  # pragma: no cover - cleanup best effort
                        logger.warning(
                            "Failed to prune webhook idempotency cache",
                            extra={"error": str(exc)},
                        )
            return stored

    # Webhook DLQ ---------------------------------------------------------

    def record_webhook_dlq(
        self,
        *,
        idempotency_key: str,
        provider: str,
        headers: Mapping[str, str],
        payload: bytes,
        error: str,
        retry_count: int = 0,
        next_retry_at: datetime | None = None,
    ) -> None:
        """Persist a webhook event into a DLQ table for later replay."""
        now = datetime.now(timezone.utc)
        scheduled = next_retry_at or now
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO webhook_dlq (
                    idempotency_key,
                    provider,
                    headers,
                    payload,
                    error,
                    retry_count,
                    next_retry_at,
                    last_error_at,
                    created_at,
                    updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (idempotency_key, provider) DO UPDATE
                SET error = EXCLUDED.error,
                    retry_count = EXCLUDED.retry_count,
                    next_retry_at = EXCLUDED.next_retry_at,
                    last_error_at = EXCLUDED.last_error_at,
                    updated_at = EXCLUDED.updated_at;
                """,
                (
                    idempotency_key,
                    provider,
                    json.dumps(dict(headers)),
                    payload,
                    error,
                    retry_count,
                    scheduled,
                    now,
                    now,
                    now,
                ),
            )

    def fetch_webhook_dlq_batch(self, *, limit: int = 50) -> list[Mapping[str, object]]:
        """Return webhook DLQ entries that are due for replay."""
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    id::text AS id,
                    idempotency_key,
                    provider,
                    headers,
                    payload,
                    error,
                    retry_count
                FROM webhook_dlq
                WHERE next_retry_at IS NULL OR next_retry_at <= NOW()
                ORDER BY created_at ASC
                LIMIT %s;
                """,
                (limit,),
            ).fetchall()
            return list(rows)

    def delete_webhook_dlq_event(self, dlq_id: str) -> None:
        """Remove a DLQ entry after successful replay."""
        with self._connect() as conn:
            conn.execute(
                """
                DELETE FROM webhook_dlq
                WHERE id = %s;
                """,
                (dlq_id,),
            )

    def increment_webhook_dlq_retry(
        self,
        *,
        dlq_id: str,
        error: str,
        base_delay_seconds: int = 60,
        max_delay_seconds: int = 3600,
    ) -> None:
        """Increment retry metadata and schedule the next replay attempt.

        Backoff uses an exponential strategy based on the current retry_count,
        capped at ``max_delay_seconds``.
        """
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT retry_count
                FROM webhook_dlq
                WHERE id = %s;
                """,
                (dlq_id,),
            ).fetchone()
            if not row:
                return
            current = int(row.get("retry_count") or 0)
            next_count = current + 1
            delay = min(base_delay_seconds * (2**current), max_delay_seconds)
            now = datetime.now(timezone.utc)
            next_at = now + timedelta(seconds=delay)
            conn.execute(
                """
                UPDATE webhook_dlq
                SET retry_count = %s,
                    error = %s,
                    next_retry_at = %s,
                    last_error_at = %s,
                    updated_at = %s
                WHERE id = %s;
                """,
                (next_count, error, next_at, now, now, dlq_id),
            )

    def _normalize_dsn(self, dsn: str) -> str:
        if dsn.startswith("postgresql+"):
            return dsn.replace("postgresql+psycopg", "postgresql", 1)
        return dsn

    # Retention
    def prune_old_artifacts(self, *, older_than_days: int) -> int:
        """Delete artifacts older than the given number of days. Returns rows deleted."""
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM artifacts
                    WHERE created_at < NOW() - INTERVAL '%s days';
                    """,
                    (older_than_days,),
                )
                return cur.rowcount or 0

    def prune_old_webhook_events(self, *, older_than_days: int) -> int:
        """Delete webhook events older than the given number of days. Returns rows deleted."""
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM webhook_events
                    WHERE received_at < NOW() - INTERVAL '%s days';
                    """,
                    (older_than_days,),
                )
                return cur.rowcount or 0

    # Socials
    def get_primary_social_for_project(self, project: str) -> Mapping[str, object] | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT s.provider, s.account_id, s.credential_ref, s.default_caption, s.default_tags, s.privacy
                FROM project_socials ps
                JOIN socials s ON s.id = ps.social_id
                WHERE ps.project = %s
                ORDER BY ps.is_primary DESC, ps.created_at ASC
                LIMIT 1;
                """,
                (project,),
            ).fetchone()
            return row

    def upsert_social(
        self,
        *,
        provider: str,
        account_id: str,
        credential_ref: str | None = None,
        default_caption: str | None = None,
        default_tags: Mapping[str, object] | None = None,
        privacy: str | None = None,
    ) -> str:
        """Insert or update a social account. Returns the social ID."""
        with self._connect() as conn:
            row = conn.execute(
                """
                INSERT INTO socials (provider, account_id, credential_ref, default_caption, default_tags, privacy)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (provider, account_id) DO UPDATE
                SET credential_ref = EXCLUDED.credential_ref,
                    default_caption = EXCLUDED.default_caption,
                    default_tags = EXCLUDED.default_tags,
                    privacy = EXCLUDED.privacy
                RETURNING id::text;
                """,
                (
                    provider,
                    account_id,
                    credential_ref,
                    default_caption,
                    json.dumps(default_tags) if default_tags else None,
                    privacy,
                ),
            ).fetchone()
            return str(row["id"])

    def link_project_to_social(
        self,
        *,
        project: str,
        social_id: str,
        is_primary: bool = True,
    ) -> None:
        """Link a project to a social account."""
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO project_socials (project, social_id, is_primary)
                VALUES (%s, %s, %s)
                ON CONFLICT (project, social_id) DO UPDATE
                SET is_primary = EXCLUDED.is_primary;
                """,
                (project, social_id, is_primary),
            )
