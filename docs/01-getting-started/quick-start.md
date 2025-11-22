# Quick Start (Python Stack)

**Audience:** Engineers/agents getting hands-on within 5 minutes.

This is the canonical Brendan-first setup for the Python stack.

---

## 0. Prerequisites
- Docker + Docker Compose
- Python 3.11
- Make (optional but convenient)
- `API_KEY` (any string for local dev)

---

## 1. Clone & Install
```bash
git clone https://github.com/yourusername/myloware.git
cd myloware

python3.11 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
cp .env.example .env
```

---

## 2. Boot the stack
```bash
make up                       # Postgres, Redis, API, Orchestrator, Prom, Grafana
docker compose -f infra/docker-compose.yml run --rm api alembic upgrade head
```

Optional: `make logs` to tail API + orchestrator.

---

## 3. Validate environment & KB
```bash
mw-py validate env            # Prints API/orchestrator URLs, mock flag, etc.
mw-py kb ingest --dir data/kb/ingested
```

---

## 4. Talk to Brendan (front door)
```bash
curl -sS -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"demo","message":"What is AISMR?"}' \
  http://localhost:8080/v1/chat/brendan
```
Expect citations + retrieval trace artifacts.

> **Why the API?** All human surfaces (CLI `mw-py`, MCP adapter, Telegram bot) should call this FastAPI route. The orchestrator’s internal `/v1/chat/brendan` endpoint is no longer exposed directly.

---

## 5. Run a pipeline demo
Use the CLI to kick off and monitor a run:
```bash
mw-py demo aismr
```
The command calls `/v1/runs/start`, polls `/v1/runs/{runId}`, and prints persona summary + publish URLs.

---

## 6. Approve HITL gates (optional)
If you used Brendan chat instead of `mw-py demo`, you’ll see `status: pending_workflow`:
```bash
curl -sS -H "x-api-key: $API_KEY" \
  http://localhost:8080/v1/hitl/approve/<runId>/workflow
```
Then approve `ideate` / `prepublish` gates the same way or via chat tools.

---

## 7. Stop the stack
```bash
make down
```

---

## Next Steps
- [docs/README.md](../README.md) — live demo checklist and health checks.
- [docs/architecture.md](../architecture.md) — component deep dive, module cross-links.
- [docs/06-reference/demo-script.md](../06-reference/demo-script.md) — scripted walkthrough for recruiters/demos.
