# MyloWare Documentation

Complete documentation for the MyloWare multi-agent video production platform.

## What to Read First

1. **[Top-level README](../README.md)** — Project overview, quick start, key features
2. **[Quick Start Guide](01-getting-started/quick-start.md)** — Get up and running in minutes
3. **[Architecture Overview](architecture.md)** — System design, components, and data flow
4. **[Development Cycle](development-cycle.md)** — Core workflow: Observe → Diagnose → Fix → Verify → Document
5. **[ROADMAP](../ROADMAP.md)** — Future features and milestones
6. **[CHANGELOG](../CHANGELOG.md)** — Release notes and version history

## Interacting with MyloWare

MyloWare provides multiple entry points for starting workflows:

- **Brendan Chat API:** `POST /v1/chat/brendan` - Natural language interface for workflow coordination
- **Telegram Bot:** Webhook integration for conversational workflow triggers
- **Direct API:** `POST /v1/runs/start` - Programmatic workflow initiation
- **MCP Adapter:** Model Context Protocol integration for tool-based access
- **CLI:** `mw-py demo` commands for quick testing

## Quick Start

See [Quick Start Guide](01-getting-started/quick-start.md) for detailed setup instructions.

**TL;DR:**
```bash
# Setup
cp .env.example .env
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'

# Start services
make up

# Run migrations
alembic upgrade head

# Health check
curl http://localhost:8080/health

# Start a workflow
mw-py demo aismr
```

## Stack Overview
- **API (FastAPI, :8080)** – Authenticated gateway, request ID + API key middleware, `/v1/runs`, `/v1/webhooks`, `/version`, `/dev/sentry-test`.
- **Orchestrator (LangGraph Server, :8090)** – Compiles the state graph, exposes `/runs/{run_id}` + `/health`, persists checkpoints in Postgres.
- **Data layer** – Postgres 15 + pgvector (`infra/postgres/init.sql` seeds extensions). Schema is managed via Alembic (`alembic/versions/20251111_01_bootstrap_schema.py`).
- **Observability** – `prometheus_fastapi_instrumentator` for metrics, LangSmith client initialization (when `LANGSMITH_*` is set), Sentry integration.

## Local Tooling
- `make up` / `make down` – wraps `docker compose -f infra/docker-compose.yml`.
- `make logs` – follow API + orchestrator logs.
- `make test` – `pytest` for `tests/unit/python_api` + `tests/unit/python_orchestrator`.
- `make smoke` – Gate A loop for `/health` + `/version` (requires running stack).
- `docker compose -f infra/docker-compose.yml run --rm api alembic upgrade head` – apply DB migrations.
 - `mw-py validate env` – quick environment check via the FastAPI `Settings` model (Python-side).
 - `mw-py ingest run --dry-run` – list personas/projects/guardrails to be ingested.
 - `mw-py ingest run` – persist ingestion metadata as artifacts (requires `DB_URL`).
 - `mw-py db vector ensure-extension` – ensure pgvector extension is installed (dev).

## Environment Configuration
### Env profiles
- `.env.development` — checked into the repo with safe mock secrets. Copy this to `.env` for day-to-day local work; overwrite values only if you need to test alternate mocks.
- `.env.real` — never checked in. Copy `.env.example`, rename to `.env.real`, and populate it with real provider credentials. When 1Password creates `.env.real` as a named pipe (default on macOS), snapshot it into a normal `.env` file with `python infra/scripts/materialize_env.py` before sourcing it. This ensures shells and Docker builds don’t hang when they try to read the pipe.
- `.env.test` / `.env.production` — reference values for CI and Fly secrets; keep them aligned with the tables below.

Key variables (see `.env.development`, `.env.test`, `.env.production`):

| Variable | Purpose |
| --- | --- |
| `API_KEY` | Required header (`x-api-key`) for all API endpoints except `/health`, `/metrics`, `/docs`, and `/v1/webhooks/*` |
| `DB_URL` / `REDIS_URL` | SQL + cache connections; containers use the internal hostnames (`postgres`, `redis`) |
| `LANGSMITH_API_KEY` | Enables LangSmith tracing for API + orchestrator |
| `SENTRY_DSN` | Enables Sentry client + `/dev/sentry-test` route |
| `KIEAI_*`, `SHOTSTACK_*`, `UPLOAD_POST_*` | Provider credentials |

`public_base_url`, `webhook_base_url`, `orchestrator_base_url`, and `providers_mode`
are derived automatically from the Fly app name. Override them only for local debugging.

## Observability Endpoints
- **Metrics:** Prometheus scrapes `api:8080/metrics` and `orchestrator:8090/metrics`; Grafana dashboard JSON lives in `infra/grafana/dashboards/orchestration-overview.json`. Pipeline-specific histograms are exposed for `kieai_job_seconds`, `shotstack_render_seconds`, `ffmpeg_normalize_seconds`, and `upload_post_seconds`, and the default dashboard plots their p95 via `histogram_quantile(...)`.
- **Traces:** Set `LANGSMITH_API_KEY`/`LANGSMITH_PROJECT` to capture `brendan-chat` and `<project>-graph` runs in LangSmith; tracing is disabled when those variables are empty.
- **Logs:** `docker compose -f infra/docker-compose.yml logs -f api orchestrator` includes request IDs and run IDs.
- **SLOs:** Tool latency target ≤ 2s p95 (`http_request_duration_seconds`), Gate A error rate < 5% enforced via `make smoke`.

## Documentation Structure

- **[01-getting-started/](01-getting-started/)** — Installation, setup, onboarding
- **[02-architecture/](02-architecture/)** — System design, data models, diagrams
- **[03-how-to/](03-how-to/)** — Guides for common tasks
- **[05-operations/](05-operations/)** — Deployment, monitoring, troubleshooting
- **[06-reference/](06-reference/)** — API reference, CLI commands, configuration
- **[07-contributing/](07-contributing/)** — Development guide, testing, code standards
