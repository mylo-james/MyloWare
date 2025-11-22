# Run Observability & Debugging

This quick-reference shows how to boot the local stack, kick off runs via Brendan, tail telemetry, and triage issues using LangSmith, logs, and the database. Everything below assumes `.env` contains the required secrets (API_KEY, LANGSMITH_API_KEY, provider keys, etc.).

## 1. Start the Stack
```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d postgres redis orchestrator api cloudflared
docker compose --env-file .env -f infra/docker-compose.yml up -d grafana prometheus otel-collector  # optional
```

## 2. Kick Off a Run
```bash
set -a && source .env
mw-py live-run test-video-gen --timeout 600  # auto-approves HITL gates
# or manually through Brendan:
curl -H "x-api-key: $API_KEY" -X POST http://localhost:8080/v1/chat/brendan \
  -d '{"user_id":"dev","message":"Start a test video gen run"}'
```

Optional flags:
- `--manual-hitl` to stop auto-approvals.
- `--message "custom prompt"` to override the default project input.

## 3. Tail Logs
```bash
docker compose --env-file .env -f infra/docker-compose.yml logs -f orchestrator api
docker compose --env-file .env -f infra/docker-compose.yml logs -f cloudflared  # watch inbound webhooks
docker compose --env-file .env -f infra/docker-compose.yml logs -f grafana prometheus  # optional
```
Structured logs include `runId`, `persona`, `providers_mode`, and provider job IDs.

## 4. Watch LangSmith in Real Time
1. Open https://smith.langchain.com/ and select the project in `LANGSMITH_PROJECT` (default `myloware-dev`).
2. Look for two RunTrees per request:
   - `brendan-chat` (conversation front door)
   - `<project>-graph` (production graph)
3. Expand the graph run to inspect child runs per persona. Each child shows tool invocations, inputs/outputs, and stack traces if something fails. You can tail these while the pipeline runs.

## 5. Inspect the Database
```bash
# Recent runs
docker exec myloware_postgres psql -U postgres -d myloware -c \
  "select run_id, project, status, job_code, updated_at from runs order by updated_at desc limit 5"

# Artifacts for a run
docker exec myloware_postgres psql -U postgres -d myloware -c \
  "select type, provider, metadata from artifacts where run_id = '<run_id>' order by created_at"

# Webhook events
docker exec myloware_postgres psql -U postgres -d myloware -c \
  "select idempotency_key, provider, signature_status, created_at from webhook_events where run_id = '<run_id>'"
```
The DB is the source of truth for `runs.result`, artifacts (`kieai.job`, `clip`, `shotstack.timeline`, `render.url`, `publish.url`), and webhook payloads.

## 6. Standard Debug Flow
| Symptom | Actions |
| --- | --- |
| Graph never calls provider | Use LangSmith RunTree to see which persona is stuck; check orchestrator logs for tool invocations filtered by `runId`. Confirm persona context allowlist contains the required tool. |
| Waiting on webhook forever | Confirm persona tool recorded submission artifacts (e.g., `kieai.job`). Tail cloudflared/API logs for incoming webhooks. In DB, check `webhook_events` for the run; if missing, verify provider callback URL configuration. |
| Provider error | LangSmith child run error + orchestrator logs include stack trace. Capture `run_id`, persona, provider job ID, and artifact metadata when filing bugs. |
| HITL gate stuck | Check artifacts for `hitl.request` entries and approve via CLI or signed link (`/v1/hitl/approve/{runId}/{gate}?token=...`). |

## 7. Clean Shutdown / Restart
- Let pytest or `mw-py live-run` finish when possible; if interrupted, note the `run_id` for cleanup.
- After changing `.env` (especially LangSmith/API keys), restart services:
```bash
docker compose --env-file .env -f infra/docker-compose.yml restart orchestrator api
```

## 8. Useful CLI Helpers
```bash
# Tail a run lifecycle (future): mw-py runs watch <run_id>
# Gather evidence for a run (artifacts/webhooks summary)
mw-py evidence --run-id <run_id>
```
(If `mw-py runs watch` is not implemented yet, fall back to `docker compose ... logs -f` and LangSmith.)

Keep this doc updated as observability tooling evolves.
