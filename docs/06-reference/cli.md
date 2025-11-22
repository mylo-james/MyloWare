## Python CLI (`mw-py`)

The Python CLI (`mw-py`) is the canonical entry point for operating the
FastAPI API, LangGraph orchestrator, and Postgres+pgvector stack. It is
installed via `pyproject.toml` and runs directly in the Python environment.

### Invocation

```bash
mw-py --help
mw-py validate env
mw-py ingest run --dry-run
```

### Command Surface

- `validate`
  - `mw-py validate env` – Validate environment variables via the FastAPI `Settings` model.
- `ingest`
  - `mw-py ingest run [--dry-run]` – Scan and record personas/projects/guardrails.
- `kb`
  - `mw-py kb ingest [--dir data/kb/ingested]` – Load knowledge base docs into Postgres + pgvector.
- `demo`
  - `mw-py demo <project>` – Kick off a canned Brendan chat (test-video-gen, aismr).
- `live-run`
  - `mw-py live-run <project> [--message ...] [--manual-hitl]` – Start a production run via Brendan, optionally auto-approving HITL gates. Prints the run ID, publish URLs, and artifact counts.
- `staging`
  - `mw-py staging deploy <api|orchestrator>` – Wrapper around `flyctl deploy -c fly.<component>.toml`.
  - `mw-py staging logs <api|orchestrator> [--filter REGEX] [--tail N]` – Tail Fly logs without writing shell pipelines.
  - `mw-py staging run start <project> [--input JSON] [--env staging]` – Start a staging run via `/v1/runs/start`.
  - `mw-py staging run status <run_id> [--env staging]` – Fetch a compact JSON status (runId, status, personas).
- `runs watch`
  - `mw-py runs watch <run_id> [--api-base ...]` – Stream run status, HITL waits, artifact counts, and LangSmith hints for an existing run. Useful for human-in-the-loop approvals or debugging long pipelines.
- `evidence`
  - `mw-py evidence <run_id> [--db-url ...] [--provider ...] [--max-events N]` – Print a JSON summary of a run, its artifacts, and matching webhook events (wraps `scripts/dev/print_run_evidence.py`).
- `db`
  - `mw-py db vector ensure-extension` – Ensure pgvector extension exists.
- `retention`
  - `mw-py retention prune [--dry-run] [--artifacts-days N] [--webhooks-days N]` – Prune old artifacts and webhook events.

In most operator workflows you should prefer `mw-py` for the Python stack.
