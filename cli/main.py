from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
from dotenv import load_dotenv

from adapters.persistence.db.database import Database

try:
    # Prefer the API settings model if available
    from apps.api.config import get_settings  # type: ignore
except Exception:  # pragma: no cover - fallback for early bootstrap
    get_settings = None  # type: ignore

try:
    from apps.orchestrator.config import get_settings as get_orchestrator_settings  # type: ignore
except Exception:  # pragma: no cover - orchestrator config optional for CLI usage
    get_orchestrator_settings = None  # type: ignore

try:
    from scripts.dev.print_run_evidence import (
        DEFAULT_PROVIDERS as _EVIDENCE_PROVIDERS,
    )
    from scripts.dev.print_run_evidence import (
        collect_run_evidence as _collect_run_evidence,
    )
    from scripts.dev.print_run_evidence import (
        resolve_db_url as _resolve_db_url,
    )
except Exception:  # pragma: no cover - CLI should still load even if tooling missing
    _EVIDENCE_PROVIDERS: tuple[str, ...] = ("kieai", "upload-post")
    _collect_run_evidence = None  # type: ignore[assignment]
    _resolve_db_url = None  # type: ignore[assignment]


_SUPPORTED_PERSONA_PROJECTS = ("test_video_gen", "aismr")

_DEMO_RUNS = {
    "test-video-gen": {
        "project": "test_video_gen",
        "input": {"prompt": "Demo Test Video Gen run via CLI"},
    },
    "aismr": {
        "project": "aismr",
        "input": {"object": "candles"},
    }
}

_PROJECT_ALIAS_MAP = {
    "test-video-gen": "test-video-gen",
    "test_video_gen": "test-video-gen",
    "testvideogen": "test-video-gen",
    "test video gen": "test-video-gen",
    "aismr": "aismr",
}

_ENV_BASES = {
    "local": "http://localhost:8080",
    "staging": "https://myloware-api-staging.fly.dev",
    "prod": "https://myloware-api.fly.dev",
}

_REPO_ROOT = Path(__file__).resolve().parents[1]


def _parse_project_key(value: str) -> str:
    normalized = value.strip().lower().replace("_", "-").replace(" ", "-")
    key = _PROJECT_ALIAS_MAP.get(normalized)
    if not key:
        raise argparse.ArgumentTypeError(
            f"Unknown project '{value}'. Supported projects: test-video-gen, aismr."
        )
    return key


def _resolve_api_base_url(preferred: str | None = None, env_hint: str | None = None) -> str:
    if preferred:
        return preferred.rstrip("/")
    hint = (env_hint or "").strip().lower()
    if hint and hint != "auto":
        base = _ENV_BASES.get(hint)
        if not base:
            raise ValueError(f"Unknown environment '{env_hint}'. Choose from local, staging, prod, auto.")
        return base
    env_base = os.getenv("API_BASE_URL")
    if env_base:
        return env_base.rstrip("/")
    if get_settings is not None:
        try:
            settings_obj = get_settings()
            candidate = (
                getattr(settings_obj, "api_base_url", None)
                or getattr(settings_obj, "public_api_base", None)
            )
            if candidate:
                return str(candidate).rstrip("/")
        except Exception:
            pass
    env = (os.getenv("CLI_API_ENV") or os.getenv("ENVIRONMENT") or "").strip().lower()
    fly_app = (os.getenv("FLY_APP_NAME") or "").strip().lower()
    if env in {"staging"} or fly_app.endswith("-staging"):
        return _ENV_BASES["staging"]
    if env in {"prod", "production"} or fly_app.endswith("-prod") or fly_app.endswith("-production"):
        return _ENV_BASES["prod"]
    return _ENV_BASES["local"]


def _normalize_dsn(url: str) -> str:
    if url.startswith("postgresql+psycopg"):
        return url.replace("postgresql+psycopg", "postgresql", 1)
    return url


def _resolve_api_key(explicit: str | None = None, *, prefer_staging: bool = False) -> str | None:
    if explicit:
        return explicit
    if prefer_staging:
        return os.getenv("STAGING_API_KEY") or os.getenv("API_KEY")
    return os.getenv("API_KEY")


def _load_json_argument(raw: str, arg_name: str) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise argparse.ArgumentTypeError(f"Invalid JSON for {arg_name}: {exc}") from exc


def _print_run_summary(summary: dict[str, Any]) -> None:
    print(json.dumps(summary, indent=2, default=_json_default_for_cli))

_PROJECT_ALIAS_MAP = {
    "test-video-gen": "test-video-gen",
    "test_video_gen": "test-video-gen",
    "testvideogen": "test-video-gen",
    "test video gen": "test-video-gen",
    "aismr": "aismr",
}


def _parse_project_key(value: str) -> str:
    normalized = value.strip().lower().replace("_", "-").replace(" ", "-")
    key = _PROJECT_ALIAS_MAP.get(normalized)
    if not key:
        raise argparse.ArgumentTypeError(
            f"Unknown project '{value}'. Supported projects: test-video-gen, aismr."
        )
    return key


def _load_env() -> None:
    if os.getenv("MWPY_SKIP_DOTENV") == "1":
        return
    """Load environment variables for the Python CLI.

    Load order:
    1) Existing process env
    2) .env (if present)
    3) .env.development (if present, non-overriding)
    """
    # Load base .env without overriding existing values
    base_env = Path(".env")
    if base_env.exists():
        load_dotenv(base_env, override=False)
    else:
        real_env = Path(".env.real")
        if real_env.exists():
            try:
                mode = real_env.lstat().st_mode
            except FileNotFoundError:  # pragma: no cover - race between exists()/lstat()
                mode = 0
            if mode and stat.S_ISFIFO(mode):
                print(
                    "warn: .env.real is a named pipe. Run `python infra/scripts/materialize_env.py` "
                    "to snapshot it into a regular .env file.",
                    file=sys.stderr,
                )
    
    # Load .env.development without overriding any existing values
    dev_env = Path(".env.development")
    if dev_env.exists():
        load_dotenv(dev_env, override=False)


def _normalize_db_url(url: str) -> str:
    if url.startswith("postgresql+psycopg://"):
        return url.replace("postgresql+psycopg://", "postgresql://", 1)
    return url


def _coerce_bool(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _verify_kb_counts(dsn: str) -> dict[str, int] | None:
    """Fetch row counts for KB tables; returns None if verification fails."""
    try:
        import psycopg
    except Exception as exc:  # pragma: no cover - psycopg missing is unlikely
        print(f"warn: unable to verify KB tables (psycopg unavailable): {exc}")
        return None
    try:
        with psycopg.connect(dsn, autocommit=True) as conn:
            docs = conn.execute("SELECT COUNT(*) FROM kb_documents").fetchone()[0]
            embeddings = conn.execute("SELECT COUNT(*) FROM kb_embeddings").fetchone()[0]
            return {"kb_documents": docs, "kb_embeddings": embeddings}
    except Exception as exc:
        print(f"warn: unable to verify KB tables: {exc}")
        return None


def _validate_env(_: argparse.Namespace) -> int:
    """Validate required environment variables via Settings model if present."""
    missing: list[str] = []
    # If api.config.Settings is available, instantiate to leverage validation
    if get_settings is not None:  # type: ignore
        try:
            settings = get_settings()
        except Exception as exc:  # pydantic validation errors bubble up here
            print("Environment validation failed:")
            print(str(exc))
            return 2

        # Minimal report of key settings
        report = {
            "environment": os.getenv("NODE_ENV") or os.getenv("ENV") or "development",
            "api_url": getattr(settings, "public_api_base", None) or getattr(settings, "api_base_url", None),
            "db_url_present": bool(getattr(settings, "db_url", "")),
            "rag_persona_prompts": bool(getattr(settings, "rag_persona_prompts", False)),
            "orchestrator_url": getattr(settings, "orchestrator_base_url", None),
            "enable_langchain_personas": getattr(settings, "enable_langchain_personas", None),
        }
        print("Environment looks OK:\n" + json.dumps(report, indent=2, sort_keys=True))
        return 0

    # Fallback: check a small set of typical keys
    for key in ("API_KEY", "DB_URL"):
        if not os.getenv(key):
            missing.append(key)
    if missing:
        print("Missing required env vars: " + ", ".join(missing))
        return 2
    print("Environment looks OK (basic checks).")
    return 0


def _validate_personas(args: argparse.Namespace) -> int:
    """Warn when LangChain personas are disabled for a production project."""

    project = args.project
    enabled = _coerce_bool(os.getenv("ENABLE_LANGCHAIN_PERSONAS"))
    providers_mode = os.getenv("PROVIDERS_MODE") or "mock"
    source = "env"
    if get_orchestrator_settings is not None:  # type: ignore
        try:
            orch_settings = get_orchestrator_settings()
            enabled = bool(getattr(orch_settings, "enable_langchain_personas", enabled))
            providers_mode = getattr(orch_settings, "providers_mode", providers_mode)
            source = "orchestrator.settings"
        except Exception:
            # Keep env-derived values when orchestrator config is unavailable
            pass

    payload = {
        "project": project,
        "enable_langchain_personas": enabled,
        "providers_mode": providers_mode,
        "source": source,
    }

    if project in _SUPPORTED_PERSONA_PROJECTS and not enabled:
        print(
            f"warn: LangChain personas are disabled for project '{project}'. "
            "Runs will stay in observation-only mode until ENABLE_LANGCHAIN_PERSONAS=true.",
            file=sys.stderr,
        )
        print(json.dumps(payload, indent=2))
        return 1

    print("LangChain personas are enabled for this project.")
    print(json.dumps(payload, indent=2))
    return 0


def _validate_config(_: argparse.Namespace) -> int:
    """Run orchestrator config smoke checks (projects, personas, adapter hosts)."""

    try:
        from apps.orchestrator.config_smoke import run_config_smoke_checks  # type: ignore
    except Exception:
        print("Config validation helpers unavailable (orchestrator not importable in this environment).")
        return 2

    settings_obj = None
    if get_orchestrator_settings is not None:  # type: ignore[name-defined]
        try:
            settings_obj = get_orchestrator_settings()
        except Exception as exc:  # pragma: no cover - surfaced to operator
            print("error: failed to load orchestrator settings for config validation:")
            print(str(exc))
            return 2

    try:
        run_config_smoke_checks(settings_obj)
    except Exception as exc:
        print("Config validation failed:")
        print(str(exc))
        return 2

    print("Config smoke checks passed.")
    return 0


def _ingest_run(args: argparse.Namespace) -> int:
    """Ingest personas, projects, guardrails. Dry-run lists planned actions.

    This is a Python-first placeholder that scans `data/` and reports
    what would be ingested. Future iterations will perform DB writes
    and/or call internal ingestion services.
    """
    base = Path("data")
    personas = list((base / "personas").rglob("*.md")) + list((base / "personas").rglob("*.json"))
    projects = list((base / "projects").rglob("*.json"))
    guardrails = list((base / "projects").rglob("guardrails/*.json"))

    summary = {
        "personas": len(personas),
        "projects": len(projects),
        "guardrails": len(guardrails),
    }
    if args.dry_run:
        print("[dry-run] Ingestion summary:\n" + json.dumps(summary, indent=2))
        # Show a few files for operator confidence
        def _sample(paths: list[Path]) -> list[str]:
            return [str(p) for p in paths[:5]]

        details = {
            "sample_personas": _sample(personas),
            "sample_projects": _sample(projects),
            "sample_guardrails": _sample(guardrails),
        }
        print(json.dumps(details, indent=2))
        return 0

    # Non-dry-run: record an ingestion run and persist file metadata as artifacts
    try:
        # Lazy import to avoid heavy deps when just printing help
        from apps.api.storage import Database  # type: ignore
        settings = get_settings() if get_settings is not None else None  # type: ignore
        dsn = getattr(settings, "db_url", None) or os.getenv("DB_URL")
        if not dsn:
            print("DB_URL is required for non-dry-run ingestion")
            return 2
        db = Database(dsn)

        run_id = str(uuid.uuid4())
        db.create_run(
            run_id=run_id,
            project="ingestion",
            status="completed",
            payload={
                "summary": summary,
                "base": str(base.resolve()),
            },
        )

        def _checksum(path: Path) -> str:
            h = hashlib.sha256()
            with path.open("rb") as fh:
                for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                    h.update(chunk)
            return h.hexdigest()

        def _store(kind: str, files: list[Path]) -> int:
            count = 0
            for p in files:
                try:
                    meta = {
                        "path": str(p),
                        "size": p.stat().st_size,
                    }
                    db.create_artifact(
                        run_id=run_id,
                        artifact_type=f"ingest.{kind}",
                        url=None,
                        provider="cli",
                        checksum=_checksum(p),
                        metadata=meta,
                    )
                    count += 1
                except Exception as exc:  # continue on error, report at end
                    print(f"warn: failed to store {p}: {exc}")
            return count

        totals = {
            "personas": _store("persona", personas),
            "projects": _store("project", projects),
            "guardrails": _store("guardrail", guardrails),
        }
        print("Ingestion complete:\n" + json.dumps({"run_id": run_id, **totals}, indent=2))
        return 0
    except Exception as exc:
        print(f"ingestion failed: {exc}")
        return 1


def _kb_ingest(args: argparse.Namespace) -> int:
    """Manual KB ingestion helper (calls core.knowledge.ingest_kb)."""
    from core.knowledge import ingest_kb  # type: ignore

    kb_dir = Path(args.dir).expanduser()
    if not kb_dir.exists():
        print(f"KB directory not found: {kb_dir}")
        return 2

    settings = get_settings() if get_settings is not None else None  # type: ignore
    dsn = getattr(settings, "db_url", None) if settings is not None else None
    dsn = dsn or os.getenv("DB_URL")
    if not dsn:
        print("DB_URL is required for kb ingest")
        return 2

    normalized_dsn = _normalize_db_url(dsn)
    try:
        ingested = ingest_kb(normalized_dsn, kb_dir)
    except Exception as exc:
        print(f"kb ingest failed: {exc}")
        return 1

    counts = _verify_kb_counts(normalized_dsn)
    summary = {
        "ingested": ingested,
        "directory": str(kb_dir),
    }
    if counts:
        summary.update(counts)
    print("KB ingest complete:\n" + json.dumps(summary, indent=2))
    return 0




def _demo_run(args: argparse.Namespace) -> int:
    env_hint = getattr(args, "env", None)
    api_key = _resolve_api_key(prefer_staging=env_hint == "staging")
    if not api_key:
        print("API_KEY is required (set it in your environment before running demo commands).")
        return 2
    try:
        base_url = _resolve_api_base_url(getattr(args, "api_base", None), env_hint)
    except ValueError as exc:
        print(f"error: {exc}")
        return 2
    prompt = getattr(args, "message", None)
    timeout = getattr(args, "timeout", 600)
    poll_interval = getattr(args, "poll_interval", 2.0)
    skip_health = getattr(args, "skip_health", False)
    runner = LiveRunRunner(
        api_base_url=base_url,
        api_key=api_key,
        project_key=args.project,
        prompt=prompt,
        timeout=timeout,
        poll_interval=poll_interval,
        check_health=not skip_health,
        auto_approve=False,
    )
    try:
        summary = runner.run()
    except TimeoutError as exc:
        print(f"Demo run timed out: {exc}")
        return 1
    except Exception as exc:
        print(f"Demo run failed: {exc}")
        return 1
    print("Demo run summary:\n" + json.dumps(summary, indent=2))
    publish_urls = summary.get("publishUrls") or []
    if publish_urls:
        print(f"Primary publish URL: {publish_urls[0]}")
    else:
        print("No publish URLs returned (check provider/mocks configuration).")
    return 0


class LiveRunRunner:
    def __init__(
        self,
        *,
        api_base_url: str,
        api_key: str,
        project_key: str,
        prompt: str | None = None,
        timeout: int = 600,
        poll_interval: float = 2.0,
        check_health: bool = True,
        auto_approve: bool = True,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if project_key not in _DEMO_RUNS:
            raise ValueError(f"Unknown project '{project_key}'")
        self.project_key = project_key
        self.project_spec = _DEMO_RUNS[project_key]
        self.prompt = prompt
        self.timeout = timeout
        self.poll_interval = poll_interval
        self.check_health = check_health
        self.auto_approve = auto_approve
        self.transport = transport
        self.api_base_url = api_base_url.rstrip("/")
        self.headers = {
            "x-api-key": api_key,
            "Content-Type": "application/json",
        }
        self.activity_log: list[str] = []

    def run(self) -> dict[str, Any]:
        with httpx.Client(timeout=self.timeout, transport=self.transport) as client:
            if self.check_health:
                self._check_health(client)
            run_id = self._start_run(client)
            final_state = self._monitor_run(client, run_id)
            result_block = final_state.get("result") or {}
            artifacts = final_state.get("artifacts") or []
            artifact_counts: dict[str, int] = {}
            for artifact in artifacts:
                provider = str(artifact.get("provider") or "unknown")
                artifact_counts[provider] = artifact_counts.get(provider, 0) + 1
            return {
                "runId": run_id,
                "project": final_state.get("project"),
                "status": final_state.get("status"),
                "publishUrls": result_block.get("publishUrls") or [],
                "artifactCount": len(artifacts),
                "artifactCounts": artifact_counts,
                "approvedGates": sorted({entry.split()[1] for entry in self.activity_log if entry.startswith("approved ")}),
                "activityLog": list(self.activity_log),
            }

    def _client_post(self, client: httpx.Client, path: str, payload: dict[str, Any]) -> httpx.Response:
        response = client.post(f"{self.api_base_url}{path}", json=payload, headers=self.headers)
        response.raise_for_status()
        return response

    def _client_get(self, client: httpx.Client, path: str, params: dict[str, str] | None = None) -> httpx.Response:
        response = client.get(f"{self.api_base_url}{path}", headers=self.headers, params=params)
        response.raise_for_status()
        return response

    def _check_health(self, client: httpx.Client) -> None:
        response = client.get(f"{self.api_base_url}/health", headers=self.headers)
        response.raise_for_status()

    def _start_run(self, client: httpx.Client) -> str:
        prompt_payload = self.project_spec["input"]
        message = self.prompt or f"Start a {self.project_spec['project']} run with input: {json.dumps(prompt_payload)}"
        chat_payload = {
            "user_id": f"mw-py-live-{self.project_spec['project']}",
            "message": message,
        }
        response = self._client_post(client, "/v1/chat/brendan", chat_payload)
        body = response.json()
        run_ids = body.get("run_ids") or []
        run_id = run_ids[0] if run_ids else None
        if not run_id:
            raise RuntimeError("chat endpoint did not return runIds")
        self._record_activity(
            f"started run {run_id}",
            echo=f"Started run {run_id} — run `mw-py runs watch {run_id}` for detailed status.",
        )
        return run_id

    def _monitor_run(self, client: httpx.Client, run_id: str) -> dict[str, Any]:
        approved: set[str] = set()
        deadline = time.monotonic() + self.timeout
        last_status = "pending"
        while time.monotonic() < deadline:
            response = self._client_get(client, f"/v1/runs/{run_id}")
            data = response.json()
            status = str(data.get("status") or "").lower()
            if status and status != last_status:
                self._record_activity(f"status -> {status}", echo=f"Run status -> {status}")
                last_status = status
            pending_gate = self._find_pending_gate(data.get("artifacts") or [], approved)
            if pending_gate and self.auto_approve:
                self._approve_gate(client, run_id, pending_gate)
                approved.add(pending_gate)
                continue
            if pending_gate and not self.auto_approve:
                self._record_activity(
                    f"awaiting {pending_gate} gate",
                    echo=f"Awaiting HITL gate '{pending_gate}' — approve via Brendan or `mw-py runs watch`.",
                )
            if status in {"published", "completed"}:
                return data
            if status in {"error", "errored", "failed"}:
                raise RuntimeError(f"run {run_id} failed with status {status}")
            time.sleep(self.poll_interval)
        raise TimeoutError(f"run {run_id} did not complete within {self.timeout} seconds")

    @staticmethod
    def _find_pending_gate(artifacts: list[dict[str, Any]], approved: set[str]) -> str | None:
        for artifact in artifacts:
            if artifact.get("type") != "hitl.request":
                continue
            metadata = artifact.get("metadata") or {}
            gate = metadata.get("gate") or artifact.get("gate")
            if gate and gate not in approved:
                return gate
        return None

    def _approve_gate(self, client: httpx.Client, run_id: str, gate: str) -> None:
        link_response = self._client_get(client, f"/v1/hitl/link/{run_id}/{gate}")
        data = link_response.json()
        token = data.get("token") or self._parse_token_from_url(data.get("approvalUrl"))
        if not token:
            raise RuntimeError(f"unable to determine approval token for gate {gate}")
        self._client_get(client, f"/v1/hitl/approve/{run_id}/{gate}", params={"token": token})
        self._record_activity(
            f"approved {gate} gate",
            echo=f"Auto-approved gate '{gate}' via API.",
        )

    @staticmethod
    def _parse_token_from_url(url: str | None) -> str | None:
        if not url:
            return None
        parsed = urlparse(url)
        query = parse_qs(parsed.query)
        values = query.get("token") or []
        return values[0] if values else None

    def _record_activity(self, message: str, *, echo: str | None = None, emit: bool = True) -> None:
        """Store activity messages and optionally print them for the operator."""

        self.activity_log.append(message)
        if not emit:
            return
        rendered = echo or message
        print(f"[{self._ts()}] {rendered}", flush=True)

    @staticmethod
    def _ts() -> str:
        return time.strftime("%H:%M:%S")


class RunWatcher:
    def __init__(
        self,
        *,
        api_base_url: str,
        api_key: str,
        run_id: str,
        poll_interval: float = 2.0,
        timeout: int = 900,
        langsmith_project: str | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.api_base_url = api_base_url.rstrip("/")
        self.api_key = api_key
        self.run_id = run_id
        self.poll_interval = poll_interval
        self.timeout = timeout
        self.langsmith_project = langsmith_project
        self.transport = transport
        self.last_status: str | None = None
        self.last_gate: str | None = None
        self.last_artifact_count = -1

    def watch(self) -> int:
        start = time.monotonic()
        if self.langsmith_project:
            print(
                f"LangSmith project '{self.langsmith_project}' — filter for runId:{self.run_id}",
            )
        else:
            print("LangSmith project not configured; set LANGSMITH_PROJECT to enable deep links.")
        with httpx.Client(timeout=15.0, transport=self.transport) as client:
            while True:
                if self.timeout > 0 and (time.monotonic() - start) > self.timeout:
                    print(f"Run {self.run_id} did not reach a terminal state within {self.timeout} seconds.")
                    return 1
                try:
                    response = client.get(
                        f"{self.api_base_url}/v1/runs/{self.run_id}",
                        headers={"x-api-key": self.api_key},
                    )
                except httpx.HTTPError as exc:
                    print(f"Request error while watching run: {exc}; retrying …")
                    time.sleep(self.poll_interval)
                    continue
                if response.status_code == 404:
                    print(f"Run {self.run_id} was not found.")
                    return 2
                response.raise_for_status()
                data = response.json()
                self._print_status(data)
                status = str(data.get("status") or "").lower()
                if status in {"published", "completed"}:
                    self._print_summary(data)
                    return 0
                if status in {"errored", "error", "failed"}:
                    self._print_summary(data)
                    return 1
                time.sleep(self.poll_interval)

    def _print_status(self, data: dict[str, Any]) -> None:
        status = str(data.get("status") or "").lower()
        if status != self.last_status:
            print(f"[{self._ts()}] status -> {status or 'unknown'}")
            self.last_status = status
        result = data.get("result") or {}
        awaiting = result.get("awaiting_gate") or data.get("awaiting_gate")
        if awaiting and awaiting != self.last_gate:
            print(f"[{self._ts()}] awaiting HITL gate '{awaiting}'")
            self.last_gate = awaiting
        artifacts = data.get("artifacts") or []
        count = len(artifacts)
        if count != self.last_artifact_count:
            latest_desc = ""
            if artifacts:
                latest = artifacts[-1]
                provider = latest.get("provider") or "unknown"
                latest_desc = f"{provider}:{latest.get('type')}"
            print(
                f"[{self._ts()}] artifacts={count}"
                + (f" latest={latest_desc}" if latest_desc else ""),
            )
            self.last_artifact_count = count

    def _print_summary(self, data: dict[str, Any]) -> None:
        result = data.get("result") or {}
        publish_urls = result.get("publishUrls") or []
        if publish_urls:
            print("Publish URLs:")
            for url in publish_urls:
                print(f" - {url}")
        else:
            print("No publish URLs recorded yet.")
        artifacts = data.get("artifacts") or []
        print(f"Total artifacts: {len(artifacts)}")
        print(f"Run {self.run_id} reached status {data.get('status')}.")

    @staticmethod
    def _ts() -> str:
        return time.strftime("%H:%M:%S")


def _json_default_for_cli(value: Any) -> str:
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return value.hex()
    return str(value)


def _live_run(args: argparse.Namespace) -> int:
    env_hint = getattr(args, "env", None)
    api_key = _resolve_api_key(prefer_staging=env_hint == "staging")
    if not api_key:
        print("API_KEY is required for live runs.")
        return 2
    try:
        base_url = _resolve_api_base_url(getattr(args, "api_base", None), env_hint)
    except ValueError as exc:
        print(f"error: {exc}")
        return 2
    prompt = getattr(args, "message", None)
    timeout = getattr(args, "timeout", 600)
    poll_interval = getattr(args, "poll_interval", 2.0)
    skip_health = getattr(args, "skip_health", False)
    manual_hitl = getattr(args, "manual_hitl", False)
    runner = LiveRunRunner(
        api_base_url=base_url,
        api_key=api_key,
        project_key=args.project,
        prompt=prompt,
        timeout=timeout,
        poll_interval=poll_interval,
        check_health=not skip_health,
        auto_approve=not manual_hitl,
    )
    try:
        summary = runner.run()
    except TimeoutError as exc:
        print(f"Live run timed out: {exc}")
        return 1
    except Exception as exc:  # pragma: no cover - network/runtime failures
        print(f"Live run failed: {exc}")
        return 1
    print("Live run summary:\n" + json.dumps(summary, indent=2))
    publish_urls = summary.get("publishUrls") or []
    if publish_urls:
        print(f"Primary publish URL: {publish_urls[0]}")
    else:
        print("No publish URLs returned (check provider/mocks configuration).")
    artifact_counts = summary.get("artifactCounts")
    if artifact_counts:
        formatted_counts = ", ".join(
            f"{provider}={count}" for provider, count in sorted(artifact_counts.items())
        )
        print(f"Artifact counts: {formatted_counts}")
    return 0


def _watch_run(args: argparse.Namespace) -> int:
    env_hint = getattr(args, "env", None)
    api_key = _resolve_api_key(prefer_staging=env_hint == "staging")
    if not api_key:
        print("API_KEY is required to watch runs.")
        return 2
    try:
        base_url = _resolve_api_base_url(getattr(args, "api_base", None), env_hint)
    except ValueError as exc:
        print(f"error: {exc}")
        return 2
    langsmith_project = (
        getattr(args, "langsmith_project", None)
        or os.getenv("LANGSMITH_PROJECT")
        or (getattr(get_settings(), "langsmith_project", None) if get_settings is not None else None)  # type: ignore[attr-defined]
    )
    watcher = RunWatcher(
        api_base_url=base_url,
        api_key=api_key,
        run_id=args.run_id,
        poll_interval=args.poll_interval,
        timeout=args.timeout,
        langsmith_project=langsmith_project,
    )
    return watcher.watch()


def _evidence(args: argparse.Namespace) -> int:
    if _collect_run_evidence is None or _resolve_db_url is None:
        print("Evidence helpers unavailable in this environment.")
        return 2
    try:
        db_url = _resolve_db_url(args.db_url)
    except RuntimeError as exc:
        print(f"error: {exc}")
        return 2
    db = Database(db_url)
    providers = args.providers or list(_EVIDENCE_PROVIDERS)
    try:
        summary = _collect_run_evidence(
            db,
            args.run_id,
            providers=providers,
            max_events=args.max_events,
        )
    except LookupError as exc:
        print(str(exc))
        return 1
    except Exception as exc:  # pragma: no cover - runtime errors should be visible
        print(f"error: failed to collect evidence: {exc}")
        return 3
    print(json.dumps(summary, indent=2, default=_json_default_for_cli))
    return 0


def _debug_persona_from_run(args: argparse.Namespace) -> int:
    """Run a persona node in isolation against an existing run's state.

    This is intended for debugging individual personas (e.g. Alex timelines)
    without re-running the full pipeline from Iggy.
    """
    from apps.orchestrator import persona_nodes  # type: ignore

    dsn = os.getenv("DB_URL")
    if not dsn:
        print("DB_URL is required to debug a persona from an existing run.")
        return 2

    db = Database(dsn)
    record = db.get_run(args.run_id)
    if not record:
        print(f"Run '{args.run_id}' not found.")
        return 1

    project = args.project or str(record.get("project") or "")
    if not project:
        print(f"Run '{args.run_id}' is missing a project; specify --project to continue.")
        return 1

    # Prefer orchestration checkpoint state when available, as it contains the
    # latest graph state for the run. Fall back to runs.result otherwise.
    state: dict[str, Any] | None = None
    if args.source == "checkpoint":
        try:
            from apps.orchestrator.checkpointer import PostgresCheckpointer  # type: ignore

            cp = PostgresCheckpointer(dsn)
            state = cp.load(args.run_id)
        except Exception as exc:  # pragma: no cover - diagnostic only
            print(f"warning: could not load checkpoint for run '{args.run_id}': {exc}")
            state = None

    # If no checkpoint state, reconstruct a minimal state from the run result.
    if state is None:
        raw_result = record.get("result")
        if raw_result is None:
            result: dict[str, Any] = {}
        elif isinstance(raw_result, str):
            try:
                result = json.loads(raw_result)
            except json.JSONDecodeError:
                result = {}
        elif isinstance(raw_result, dict):
            result = raw_result
        else:
            result = dict(raw_result)

        state = {
            "run_id": record.get("run_id"),
            "project": project,
            "videos": result.get("videos") or [],
            "clips": result.get("clips") or [],
            "transcript": result.get("transcript") or [],
            "persona_history": result.get("persona_history") or [],
        }
    else:
        # Ensure core keys are present on checkpoint-derived state.
        state.setdefault("run_id", record.get("run_id"))
        state.setdefault("project", project)

    persona = args.persona

    # For debugging we want to exercise the LangChain personas even if the
    # orchestrator is running with ENABLE_LANGCHAIN_PERSONAS=false locally.
    try:  # pragma: no cover - defensive; settings may not be mutable in some envs
        setattr(persona_nodes.settings, "enable_langchain_personas", True)
    except Exception:
        pass

    # When debugging Alex specifically, avoid calling the real Shotstack adapter
    # and instead print the timeline payload that would be submitted.
    original_shotstack_factory = None
    if persona == "alex":
        try:
            original_shotstack_factory = persona_nodes.persona_tools.build_shotstack_client
        except Exception:
            original_shotstack_factory = None

        class _DebugShotstackPreview:
            def render(self, timeline):  # type: ignore[override]
                print("\n=== Debug Alex timeline preview ===")
                try:
                    print(json.dumps(timeline, indent=2, default=_json_default_for_cli))
                except TypeError:
                    print(str(timeline))
                print("=== End timeline preview ===\n")
                return {"url": "debug://render.mp4", "status": "debug", "id": "debug"}

        if original_shotstack_factory is not None:
            persona_nodes.persona_tools.build_shotstack_client = (  # type: ignore[assignment]
                lambda *_, **__: _DebugShotstackPreview()
            )

    try:
        node = persona_nodes.create_persona_node(persona, project)
    except Exception as exc:  # pragma: no cover - configuration/runtime issues
        print(f"error: unable to create persona node '{persona}' for project '{project}': {exc}")
        return 3

    print(
        f"Running persona '{persona}' locally for run '{args.run_id}' "
        f"(project={project}, source={args.source}) …"
    )
    try:
        next_state = node(state)  # type: ignore[arg-type]
    except Exception as exc:  # pragma: no cover - runtime errors should be visible
        print(f"Persona '{persona}' execution failed: {exc}")
        return 3
    finally:
        if persona == "alex" and original_shotstack_factory is not None:
            try:
                persona_nodes.persona_tools.build_shotstack_client = original_shotstack_factory  # type: ignore[assignment]
            except Exception:
                pass

    # Print a concise summary of what the persona produced.
    summary = {
        "runId": next_state.get("run_id"),
        "project": next_state.get("project"),
        "persona": persona,
        "videos": next_state.get("videos"),
        "clips": next_state.get("clips"),
        "persona_history": next_state.get("persona_history"),
    }
    print(json.dumps(summary, indent=2, default=_json_default_for_cli))
    return 0


_FLY_CONFIG_FILES = {
    "orchestrator": "fly.orchestrator.toml",
    "api": "fly.api.toml",
}


def _staging_deploy(args: argparse.Namespace) -> int:
    config = _FLY_CONFIG_FILES[args.component]
    cmd = ["flyctl", "deploy", "-c", config]
    if args.strategy:
        cmd += ["--strategy", args.strategy]
    result = subprocess.run(cmd, cwd=_REPO_ROOT)
    return result.returncode


def _staging_logs(args: argparse.Namespace) -> int:
    config = _FLY_CONFIG_FILES[args.component]
    cmd = ["flyctl", "logs", "-c", config]
    if not getattr(args, "follow", False):
        cmd.append("--no-tail")
    proc = subprocess.run(cmd, cwd=_REPO_ROOT, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr or "")
        return proc.returncode
    lines = proc.stdout.splitlines()
    if args.filter:
        pattern = re.compile(args.filter)
        lines = [line for line in lines if pattern.search(line)]
    if args.lines:
        lines = lines[-args.lines :]
    if args.tail:
        lines = lines[-args.tail :]
    print("\n".join(lines))
    return 0


def _staging_run_start(args: argparse.Namespace) -> int:
    config = _DEMO_RUNS[args.project]
    api_key = _resolve_api_key(args.api_key, prefer_staging=True)
    if not api_key:
        print("API key required (set STAGING_API_KEY or API_KEY).")
        return 2
    try:
        base_url = _resolve_api_base_url(getattr(args, "api_base", None), getattr(args, "env", "staging"))
    except ValueError as exc:
        print(f"error: {exc}")
        return 2
    headers = {"x-api-key": api_key, "Content-Type": "application/json"}
    if args.input:
        try:
            input_payload = json.loads(args.input)
        except json.JSONDecodeError as exc:
            print(f"Invalid JSON for --input: {exc}")
            return 2
    else:
        input_payload = {"prompt": args.prompt}
    body = {"project": config["project"], "input": input_payload}
    try:
        response = httpx.post(
            f"{base_url}/v1/runs/start",
            headers=headers,
            json=body,
            timeout=30.0,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        print(f"Run start failed: {exc}")
        if exc.response is not None:
            print(exc.response.text)
        return 1
    data = response.json()
    run_id = data.get("runId") or data.get("run_id")
    if not run_id:
        print("API response missing runId:")
        _print_run_summary(data)
        return 1
    summary = {
        "runId": run_id,
        "project": data.get("project") or config["project"],
        "status": data.get("status"),
    }
    print("Run started:")
    _print_run_summary(summary)
    return 0


def _staging_run_status(args: argparse.Namespace) -> int:
    api_key = _resolve_api_key(args.api_key, prefer_staging=True)
    if not api_key:
        print("API key required (set STAGING_API_KEY or API_KEY).")
        return 2
    try:
        base_url = _resolve_api_base_url(getattr(args, "api_base", None), getattr(args, "env", "staging"))
    except ValueError as exc:
        print(f"error: {exc}")
        return 2
    headers = {"x-api-key": api_key, "Content-Type": "application/json"}
    try:
        response = httpx.get(
            f"{base_url}/v1/runs/{args.run_id}",
            headers=headers,
            timeout=30.0,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        print(f"Run status failed: {exc}")
        if exc.response is not None:
            print(exc.response.text)
        return 1
    data = response.json()
    personas = sorted(
        {
            (artifact.get("metadata") or {}).get("persona")
            for artifact in data.get("artifacts") or []
            if (artifact.get("metadata") or {}).get("persona")
        }
    )
    summary = {
        "runId": data.get("run_id") or data.get("runId"),
        "project": data.get("project"),
        "status": data.get("status"),
        "personas": personas,
    }
    _print_run_summary(summary)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="mw-py", description="MyloWare CLI (Python)")
    sub = parser.add_subparsers(dest="command")

    # validate env
    validate = sub.add_parser("validate", help="Validation helpers")
    validate_sub = validate.add_subparsers(dest="subcommand")
    env_cmd = validate_sub.add_parser("env", help="Validate environment configuration")
    env_cmd.set_defaults(func=_validate_env)
    personas_cmd = validate_sub.add_parser("personas", help="Check LangChain persona gating for a project")
    personas_cmd.add_argument(
        "--project",
        choices=_SUPPORTED_PERSONA_PROJECTS,
        default="test_video_gen",
        help="Project you plan to run (defaults to test_video_gen)",
    )
    personas_cmd.set_defaults(func=_validate_personas)
    config_cmd = validate_sub.add_parser("config", help="Run orchestrator config smoke checks")
    config_cmd.set_defaults(func=_validate_config)

    # ingest run
    ingest = sub.add_parser("ingest", help="Ingestion helpers")
    ingest_sub = ingest.add_subparsers(dest="subcommand")
    run_cmd = ingest_sub.add_parser("run", help="Ingest personas, projects, guardrails")
    run_cmd.add_argument("--dry-run", action="store_true", help="Do not write; print summary only")
    run_cmd.set_defaults(func=_ingest_run)

    # knowledge base helpers
    kb = sub.add_parser("kb", help="Knowledge base helpers")
    kb_sub = kb.add_subparsers(dest="subcommand")
    kb_ingest = kb_sub.add_parser("ingest", help="Ingest KB documents into Postgres/pgvector")
    kb_ingest.add_argument(
        "--dir",
        default="data/kb/ingested",
        help="Directory containing markdown/JSON knowledge sources (default: data/kb/ingested)",
    )
    kb_ingest.set_defaults(func=_kb_ingest)

    demo = sub.add_parser("demo", help="Run a canned demo pipeline via the API")
    demo.add_argument(
        "project",
        type=_parse_project_key,
        metavar="PROJECT",
        help="Which demo pipeline to run (test-video-gen, aismr)",
    )
    demo.add_argument("--api-base", dest="api_base", help="Override API base URL (defaults to environment detection)")
    demo.add_argument("--env", choices=("auto", "local", "staging", "prod"), default=None, help="Target environment for API base detection")
    demo.add_argument("--message", help="Override the chat message sent to Brendan")
    demo.add_argument("--timeout", type=int, default=600, help="Seconds to wait for run completion (default: 600)")
    demo.add_argument("--poll-interval", type=float, default=2.0, help="Seconds between status polls (default: 2)")
    demo.add_argument("--skip-health", action="store_true", help="Skip the initial /health probe")
    demo.set_defaults(func=_demo_run)

    live = sub.add_parser("live-run", help="Start a run via Brendan, auto-approve HITL gates, and wait for publish")
    live.add_argument(
        "project",
        type=_parse_project_key,
        metavar="PROJECT",
        help="Which project to run (test-video-gen, aismr)",
    )
    live.add_argument("--api-base", dest="api_base", help="Override API base URL (defaults to API_BASE_URL or settings)")
    live.add_argument("--env", choices=("auto", "local", "staging", "prod"), default=None, help="Target environment for API base detection")
    live.add_argument("--message", help="Override the chat message sent to Brendan")
    live.add_argument("--timeout", type=int, default=600, help="Seconds to wait for run completion (default: 600)")
    live.add_argument("--poll-interval", type=float, default=2.0, help="Seconds between status polls (default: 2)")
    live.add_argument("--skip-health", action="store_true", help="Skip the initial /health probe")
    live.add_argument(
        "--manual-hitl",
        "--no-auto-hitl",
        dest="manual_hitl",
        action="store_true",
        help="Do not auto-approve HITL gates; just watch for status changes",
    )
    live.set_defaults(func=_live_run)

    runs_cmd = sub.add_parser("runs", help="Run utilities")
    runs_sub = runs_cmd.add_subparsers(dest="runs_subcommand")
    watch_cmd = runs_sub.add_parser("watch", help="Watch an existing run's status in real time")
    watch_cmd.add_argument("run_id", help="Run identifier (UUID) to watch")
    watch_cmd.add_argument("--api-base", dest="api_base", help="Override API base URL (defaults to API_BASE_URL or settings)")
    watch_cmd.add_argument("--poll-interval", type=float, default=2.0, help="Seconds between status polls (default: 2)")
    watch_cmd.add_argument("--timeout", type=int, default=900, help="Seconds to wait before giving up (default: 900)")
    watch_cmd.add_argument("--env", choices=("auto", "local", "staging", "prod"), default=None, help="Target environment for API base detection")
    watch_cmd.add_argument(
        "--langsmith-project",
        dest="langsmith_project",
        help="Override LangSmith project name used when printing trace hints",
    )
    watch_cmd.set_defaults(func=_watch_run)

    debug_persona_cmd = runs_sub.add_parser(
        "debug-persona",
        help="Run a persona against an existing run's state without re-running the full pipeline",
    )
    debug_persona_cmd.add_argument(
        "persona",
        choices=("iggy", "riley", "alex", "quinn"),
        help="Persona to execute (iggy, riley, alex, quinn)",
    )
    debug_persona_cmd.add_argument("run_id", help="Run ID to load state from")
    debug_persona_cmd.add_argument(
        "--project",
        choices=_SUPPORTED_PERSONA_PROJECTS,
        help="Override project if the run record is missing one",
    )
    debug_persona_cmd.add_argument(
        "--source",
        choices=("checkpoint", "result"),
        default="checkpoint",
        help="Which state source to use: latest checkpoint or stored run result (default: checkpoint)",
    )
    debug_persona_cmd.set_defaults(func=_debug_persona_from_run)

    evidence_cmd = sub.add_parser("evidence", help="Summarize run artifacts and webhook events")
    evidence_cmd.add_argument("run_id", help="Run ID to inspect")
    evidence_cmd.add_argument("--db-url", dest="db_url", help="Override DB_URL when connecting to Postgres")
    evidence_cmd.add_argument(
        "--provider",
        dest="providers",
        action="append",
        help="Limit webhook events to a provider (repeatable; defaults to kieai + upload-post)",
    )
    evidence_cmd.add_argument(
        "--max-events",
        dest="max_events",
        type=int,
        default=200,
        help="Maximum webhook events to fetch before filtering (default: 200)",
    )
    evidence_cmd.set_defaults(func=_evidence)

    # db helpers --------------------------------------------------------
    db = sub.add_parser("db", help="Database utilities")
    db_sub = db.add_subparsers(dest="subcommand")

    def _db_purge_runs(args: argparse.Namespace) -> int:
        import psycopg
        from psycopg.rows import dict_row

        dsn = os.getenv("DB_URL")
        if not dsn:
            print("DB_URL is required")
            return 2

        dsn = _normalize_dsn(dsn)
        run_ids: list[str] = []
        with psycopg.connect(dsn, autocommit=True, row_factory=dict_row) as conn:
            if args.run_ids:
                run_ids = [rid for rid in args.run_ids if rid]
            elif args.older_than_days is not None:
                rows = conn.execute(
                    "SELECT run_id FROM runs WHERE created_at < NOW() - (%s || ' days')::interval",
                    (args.older_than_days,),
                ).fetchall()
                run_ids = [str(row["run_id"]) for row in rows]
            else:
                print("Specify --run-id (repeatable) or --older-than-days.")
                return 2

            if not run_ids:
                print("No runs matched filter.")
                return 0

            if args.dry_run:
                print(json.dumps({"matched": len(run_ids), "run_ids": run_ids}, indent=2))
                return 0

            for run_id in run_ids:
                conn.execute("DELETE FROM hitl_approvals WHERE run_id = %s", (run_id,))
                conn.execute("DELETE FROM orchestration_checkpoints WHERE run_id = %s", (run_id,))
                conn.execute("DELETE FROM artifacts WHERE run_id = %s", (run_id,))
                conn.execute("DELETE FROM runs WHERE run_id = %s", (run_id,))

        print(json.dumps({"purged": len(run_ids)}))
        return 0

    def _db_seed_socials(_: argparse.Namespace) -> int:
        import psycopg
        from psycopg.rows import dict_row

        dsn = os.getenv("DB_URL")
        if not dsn:
            print("DB_URL is required")
            return 2

        dsn = _normalize_dsn(dsn)
        with psycopg.connect(dsn, autocommit=True, row_factory=dict_row) as conn:
            row = conn.execute(
                """
                INSERT INTO socials (provider, account_id, credential_ref, default_caption, default_tags, privacy)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
                RETURNING id::text;
                """,
                ("upload-post", "AISMR", None, None, None, None),
            ).fetchone()

            if not row:
                row = conn.execute(
                    """
                    SELECT id::text FROM socials
                    WHERE provider = %s AND account_id = %s;
                    """,
                    ("upload-post", "AISMR"),
                ).fetchone()

            if not row:
                print("Failed to upsert socials record")
                return 2

            social_id = str(row["id"])
            conn.execute(
                """
                INSERT INTO project_socials (project, social_id, is_primary)
                VALUES (%s, %s, %s)
                ON CONFLICT (project, social_id) DO UPDATE
                SET is_primary = EXCLUDED.is_primary;
                """,
                ("test_video_gen", social_id, True),
            )

        print(json.dumps({"social_id": social_id, "project": "test_video_gen"}, indent=2))
        return 0

    purge_runs_cmd = db_sub.add_parser("purge-runs", help="Delete runs, artifacts, checkpoints")
    purge_runs_cmd.add_argument(
        "--run-id",
        dest="run_ids",
        action="append",
        help="Run ID to delete (repeatable). If omitted, use --older-than-days.",
    )
    purge_runs_cmd.add_argument(
        "--older-than-days",
        type=int,
        help="Delete runs created before N days ago.",
    )
    purge_runs_cmd.add_argument(
        "--dry-run",
        action="store_true",
        help="List matching run IDs without deleting",
    )
    purge_runs_cmd.set_defaults(func=_db_purge_runs)

    seed_cmd = db_sub.add_parser("seed", help="Seed default socials/project mapping")
    seed_cmd.set_defaults(func=_db_seed_socials)

    def _vector_ensure_ext(_: argparse.Namespace) -> int:
        try:
            from adapters.persistence.vector.pgvector import ensure_extension  # type: ignore
        except Exception as exc:  # pragma: no cover - import guard
            print(f"pgvector helpers unavailable: {exc}")
            return 2
        dsn = os.getenv("DB_URL")
        if not dsn:
            print("DB_URL is required")
            return 2
        ensure_extension(dsn)
        print("vector extension ensured")
        return 0

    # retention helpers
    retention = sub.add_parser("retention", help="Data retention helpers")
    retention_sub = retention.add_subparsers(dest="subcommand")

    def _retention_prune(args: argparse.Namespace) -> int:
        from adapters.persistence.db.database import Database  # type: ignore

        dsn = os.getenv("DB_URL")
        if not dsn:
            print("DB_URL is required")
            return 2
        db = Database(dsn)
        artifacts_days = args.artifacts_days
        webhooks_days = args.webhooks_days
        dry_run = args.dry_run
        if dry_run:
            print(
                f"[dry-run] Would prune artifacts older than {artifacts_days}d "
                f"and webhook events older than {webhooks_days}d",
            )
            return 0
        deleted_artifacts = db.prune_old_artifacts(older_than_days=artifacts_days)
        deleted_webhooks = db.prune_old_webhook_events(older_than_days=webhooks_days)
        print(
            "prune complete: "
            + json.dumps(
                {
                    "artifacts_deleted": deleted_artifacts,
                    "webhook_events_deleted": deleted_webhooks,
                },
                indent=2,
            ),
        )
        return 0

    prune_cmd = retention_sub.add_parser("prune", help="Prune old artifacts and webhook events")
    prune_cmd.add_argument(
        "--artifacts-days",
        type=int,
        default=90,
        help="Delete artifacts older than this many days (default: 90)",
    )
    prune_cmd.add_argument(
        "--webhooks-days",
        type=int,
        default=14,
        help="Delete webhook events older than this many days (default: 14)",
    )
    prune_cmd.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be pruned without deleting",
    )
    prune_cmd.set_defaults(func=_retention_prune)

    # DLQ helpers --------------------------------------------------------

    def _dlq_replay_webhooks(args: argparse.Namespace) -> int:
        """Replay webhook DLQ entries by POSTing them back to the API.

        This is intended as an operational tool that can be run manually or
        scheduled (e.g. via cron) to drain the DLQ with bounded retries.
        """
        from adapters.persistence.db.database import Database  # type: ignore

        dsn = os.getenv("DB_URL")
        if not dsn:
            print("DB_URL is required")
            return 2
        db = Database(dsn)
        batch = db.fetch_webhook_dlq_batch(limit=args.limit)
        summary = {"count": len(batch)}
        if args.dry_run:
            print("[dry-run] Would replay webhook DLQ events:\n" + json.dumps(summary, indent=2))
            return 0
        if not batch:
            print("No webhook DLQ events to replay.")
            return 0

        base_url: str | None = os.getenv("API_BASE_URL")
        if not base_url and get_settings is not None:
            try:
                base_url = getattr(get_settings(), "api_base_url", None)
            except Exception:
                base_url = None
        base_url = (base_url or "http://localhost:8080").rstrip("/")

        provider_paths = {
            "kieai": "/v1/webhooks/kieai",
            "upload-post": "/v1/webhooks/upload-post",
        }

        with httpx.Client(timeout=30) as client:
            for row in batch:
                provider = str(row.get("provider") or "").lower()
                path = provider_paths.get(provider)
                if not path:
                    # Unknown provider; leave the entry in the DLQ.
                    continue
                headers = dict(row.get("headers") or {})
                payload = row.get("payload") or b""
                try:
                    resp = client.post(f"{base_url}{path}", headers=headers, content=payload)
                    resp.raise_for_status()
                except Exception as exc:
                    db.increment_webhook_dlq_retry(dlq_id=str(row.get("id")), error=str(exc))
                else:
                    db.delete_webhook_dlq_event(str(row.get("id")))
        return 0

    def _vector_create_hnsw(args: argparse.Namespace) -> int:
        from adapters.persistence.vector.pgvector import create_hnsw_index  # type: ignore
        dsn = os.getenv("DB_URL")
        if not dsn:
            print("DB_URL is required")
            return 2
        create_hnsw_index(
            dsn,
            table=args.table,
            column=args.column,
            index_name=args.index,
            m=args.m,
            ef_construction=args.ef,
            opclass=args.opclass,
        )
        print("hnsw index created (or existed)")
        return 0

    def _vector_create_ivf(args: argparse.Namespace) -> int:
        from adapters.persistence.vector.pgvector import create_ivfflat_index  # type: ignore
        dsn = os.getenv("DB_URL")
        if not dsn:
            print("DB_URL is required")
            return 2
        create_ivfflat_index(
            dsn,
            table=args.table,
            column=args.column,
            index_name=args.index,
            lists=args.lists,
            opclass=args.opclass,
        )
        print("ivfflat index created (or existed)")
        return 0

    def _vector_drop(args: argparse.Namespace) -> int:
        from adapters.persistence.vector.pgvector import drop_vector_indexes  # type: ignore
        dsn = os.getenv("DB_URL")
        if not dsn:
            print("DB_URL is required")
            return 2
        count = drop_vector_indexes(dsn, table=args.table, prefix=args.prefix)
        print(json.dumps({"dropped": count}))
        return 0

    def _vector_stats(args: argparse.Namespace) -> int:
        from adapters.persistence.vector.pgvector import index_stats  # type: ignore
        dsn = os.getenv("DB_URL")
        if not dsn:
            print("DB_URL is required")
            return 2
        rows = index_stats(dsn, table=args.table)
        print(json.dumps(rows, indent=2))
        return 0

    vec = db_sub.add_parser("vector", help="pgvector index helpers")
    vec_sub = vec.add_subparsers(dest="action")

    vext = vec_sub.add_parser("ensure-extension", help="CREATE EXTENSION IF NOT EXISTS vector")
    vext.set_defaults(func=_vector_ensure_ext)

    vhnsw = vec_sub.add_parser("create-hnsw", help="Create HNSW index")
    vhnsw.add_argument("--table", required=True)
    vhnsw.add_argument("--column", default="embedding")
    vhnsw.add_argument("--index", default=None)
    vhnsw.add_argument("--m", type=int, default=16)
    vhnsw.add_argument("--ef", type=int, default=200)
    vhnsw.add_argument("--opclass", default="vector_l2_ops")
    vhnsw.set_defaults(func=_vector_create_hnsw)

    vivf = vec_sub.add_parser("create-ivfflat", help="Create IVFFlat index")
    vivf.add_argument("--table", required=True)
    vivf.add_argument("--column", default="embedding")
    vivf.add_argument("--index", default=None)
    vivf.add_argument("--lists", type=int, default=100)
    vivf.add_argument("--opclass", default="vector_l2_ops")
    vivf.set_defaults(func=_vector_create_ivf)

    vdrop = vec_sub.add_parser("drop", help="Drop vector indexes on a table")
    vdrop.add_argument("--table", required=True)
    vdrop.add_argument("--prefix", default=None)
    vdrop.set_defaults(func=_vector_drop)

    vstats = vec_sub.add_parser("stats", help="Show index metadata")
    vstats.add_argument("--table", required=True)
    vstats.set_defaults(func=_vector_stats)

    # dlq helpers
    dlq = sub.add_parser("dlq", help="Dead-letter queue helpers")
    dlq_sub = dlq.add_subparsers(dest="subcommand")
    dlq_replay = dlq_sub.add_parser("replay-webhooks", help="Replay webhook DLQ events via API")
    dlq_replay.add_argument(
        "--limit",
        type=int,
        default=50,
        help="Maximum number of events to replay in a single run (default: 50)",
    )
    dlq_replay.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the number of DLQ events that would be replayed without invoking HTTP calls",
    )
    dlq_replay.set_defaults(func=_dlq_replay_webhooks)

    staging = sub.add_parser("staging", help="Staging/Fly helpers")
    staging_sub = staging.add_subparsers(dest="staging_subcommand")

    deploy_cmd = staging_sub.add_parser("deploy", help="Deploy a Fly app (orchestrator/api)")
    deploy_cmd.add_argument("component", choices=("orchestrator", "api"), help="Which Fly app to deploy")
    deploy_cmd.add_argument("--strategy", help="flyctl --strategy value (e.g., immediate, rolling)")
    deploy_cmd.set_defaults(func=_staging_deploy)

    logs_cmd = staging_sub.add_parser("logs", help="Tail Fly logs with optional filtering")
    logs_cmd.add_argument("component", choices=("orchestrator", "api"), help="Which Fly app to tail logs for")
    logs_cmd.add_argument("--lines", type=int, default=200, help="Max lines to display after filtering (default: 200)")
    logs_cmd.add_argument("--filter", help="Regex filter applied to logs (after retrieval)")
    logs_cmd.add_argument("--tail", type=int, default=0, help="Only print the last N filtered lines")
    logs_cmd.add_argument("--follow", action="store_true", help="Stream logs continuously instead of exiting")
    logs_cmd.set_defaults(func=_staging_logs)

    staging_run = staging_sub.add_parser("run", help="Manage staging runs via the public API")
    staging_run_sub = staging_run.add_subparsers(dest="staging_run_subcommand")

    run_start = staging_run_sub.add_parser("start", help="Start a staging run via /v1/runs/start")
    run_start.add_argument("project", type=_parse_project_key, metavar="PROJECT", help="Project to run (test-video-gen, aismr)")
    run_start.add_argument("--input", help='JSON payload for "input" field (defaults to {"prompt": "..."}).')
    run_start.add_argument("--prompt", help="Simple prompt string when --input is omitted", default="Staging run from CLI")
    run_start.add_argument("--api-key", dest="api_key", help="Override API key (defaults to STAGING_API_KEY or API_KEY)")
    run_start.add_argument("--api-base", dest="api_base", help="Override API base URL")
    run_start.add_argument("--env", choices=("auto", "local", "staging", "prod"), default="staging", help="Environment hint for API base resolution")
    run_start.set_defaults(func=_staging_run_start)

    run_status = staging_run_sub.add_parser("status", help="Fetch run status from staging API")
    run_status.add_argument("run_id", help="Run identifier to inspect")
    run_status.add_argument("--api-key", dest="api_key", help="Override API key (defaults to STAGING_API_KEY or API_KEY)")
    run_status.add_argument("--api-base", dest="api_base", help="Override API base URL")
    run_status.add_argument("--env", choices=("auto", "local", "staging", "prod"), default="staging", help="Environment hint for API base resolution")
    run_status.set_defaults(func=_staging_run_status)

    return parser


def main(argv: list[str] | None = None) -> int:
    _load_env()
    parser = build_parser()
    args = parser.parse_args(argv)
    if not hasattr(args, "func"):
        parser.print_help()
        return 1
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
