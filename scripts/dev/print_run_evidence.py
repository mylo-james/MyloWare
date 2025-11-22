#!/usr/bin/env python3
"""Print a compact JSON summary of a run, its artifacts, and relevant webhook events."""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Mapping, Sequence

try:  # pragma: no cover - optional dependency for CLI parity
    from apps.api.config import get_settings  # type: ignore
except Exception:  # pragma: no cover - settings may be unavailable in some contexts
    get_settings = None  # type: ignore

from adapters.persistence.db.database import Database

DEFAULT_PROVIDERS: tuple[str, ...] = ("kieai", "upload-post")
_PAYLOAD_PREVIEW_LIMIT = 400


def resolve_db_url(explicit: str | None) -> str:
    """Resolve the database URL using CLI flag, env vars, or settings."""
    if explicit:
        return explicit
    env_value = os.getenv("DB_URL")
    if env_value:
        return env_value
    if get_settings is not None:
        try:
            settings = get_settings()
        except Exception as exc:  # pragma: no cover - validation errors bubble to CLI
            raise RuntimeError(f"unable to load settings for DB URL: {exc}") from exc
        candidate = getattr(settings, "db_url", None)
        if candidate:
            return str(candidate)
    raise RuntimeError("DB_URL not provided; set --db-url or export DB_URL")


def collect_run_evidence(
    db: Database,
    run_id: str,
    *,
    providers: Sequence[str] | None = None,
    max_events: int = 200,
) -> dict[str, Any]:
    """Gather run/artifact/webhook evidence for the given run id."""
    run_record = db.get_run(run_id)
    if not run_record:
        raise LookupError(f"Run '{run_id}' not found")

    artifacts = db.list_artifacts(run_id)
    events = db.list_webhook_events(providers=providers, limit=max_events)

    event_summaries: list[dict[str, Any]] = []
    for event in events:
        summary = _summarize_webhook_event(event, run_id)
        if summary:
            event_summaries.append(summary)
    event_summaries.sort(key=lambda item: str(item.get("receivedAt") or ""))

    return {
        "run": _summarize_run(run_record),
        "artifacts": [_summarize_artifact(artifact) for artifact in artifacts],
        "webhookEvents": event_summaries,
    }


def _summarize_run(run_record: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "run_id": run_record.get("run_id"),
        "project": run_record.get("project"),
        "status": run_record.get("status"),
        "created_at": _stringify_datetime(run_record.get("created_at")),
        "updated_at": _stringify_datetime(run_record.get("updated_at")),
        "payload": run_record.get("payload"),
        "result": run_record.get("result"),
    }


def _summarize_artifact(artifact: Mapping[str, Any]) -> dict[str, Any]:
    summary = {
        "id": str(artifact.get("id")),
        "type": artifact.get("type"),
        "provider": artifact.get("provider"),
        "url": artifact.get("url"),
        "created_at": _stringify_datetime(artifact.get("created_at")),
    }
    persona = artifact.get("persona")
    if persona:
        summary["persona"] = persona
    metadata = artifact.get("metadata")
    if metadata:
        summary["metadata"] = metadata
    checksum = artifact.get("checksum")
    if checksum:
        summary["checksum"] = checksum
    return summary


def _summarize_webhook_event(event: Mapping[str, Any], run_id: str) -> dict[str, Any] | None:
    payload_text = _decode_payload(event.get("payload"))
    header_text = json.dumps(event.get("headers") or {}, sort_keys=True, default=str)
    matched: list[str] = []
    if run_id in payload_text:
        matched.append("payload")
    if run_id in header_text:
        matched.append("headers")
    if not matched:
        return None
    preview = payload_text[:_PAYLOAD_PREVIEW_LIMIT]
    return {
        "id": event.get("id"),
        "provider": event.get("provider"),
        "idempotencyKey": event.get("idempotency_key"),
        "signatureStatus": event.get("signature_status"),
        "receivedAt": _stringify_datetime(event.get("received_at")),
        "matchedOn": matched,
        "payloadPreview": preview,
        "headers": event.get("headers"),
    }


def _decode_payload(payload: Any) -> str:
    if payload is None:
        return ""
    if isinstance(payload, memoryview):
        payload = payload.tobytes()
    if isinstance(payload, bytes):
        try:
            return payload.decode("utf-8")
        except UnicodeDecodeError:
            return payload.hex()
    return str(payload)


def _stringify_datetime(value: Any) -> str | None:
    if value is None:
        return None
    iso = getattr(value, "isoformat", None)
    if callable(iso):
        try:
            return iso()
        except Exception:  # pragma: no cover - defensive fallback
            return str(value)
    return str(value)


def _json_default(value: Any) -> str:
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return value.hex()
    return str(value)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Print run, artifact, and webhook evidence for a runId")
    parser.add_argument("run_id", help="Run ID to inspect")
    parser.add_argument("--db-url", dest="db_url", help="Override DB_URL env variable")
    parser.add_argument(
        "--provider",
        dest="providers",
        action="append",
        help="Limit webhook events to the given provider (repeatable)",
    )
    parser.add_argument(
        "--max-events",
        dest="max_events",
        type=int,
        default=200,
        help="Maximum webhook events to fetch before filtering (default: 200)",
    )
    args = parser.parse_args(argv)

    providers = args.providers or list(DEFAULT_PROVIDERS)
    try:
        db_url = resolve_db_url(args.db_url)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    db = Database(db_url)
    try:
        summary = collect_run_evidence(db, args.run_id, providers=providers, max_events=args.max_events)
    except LookupError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except Exception as exc:  # pragma: no cover - runtime errors reported to operator
        print(f"error: failed to collect evidence: {exc}", file=sys.stderr)
        return 3

    print(json.dumps(summary, indent=2, default=_json_default))
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entrypoint
    raise SystemExit(main())
