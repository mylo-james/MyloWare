# Observability & Diagnostics (Python Stack)

Use LangSmith, Prometheus, and logs to understand how a run moves from chat to publish. This document describes the current FastAPI + LangGraph services only.

---

## Watching Runs with watch_run.py

When you start a run through Brendan, capture the `run_id` from the `/v1/chat/brendan` response and stream the run locally.

```bash
RUN_ID=$(
  curl -sS http://localhost:8080/v1/chat/brendan \
    -H "x-api-key: dev-local-api-key" \
    -H "Content-Type: application/json" \
    -d '{"user_id":"watcher","message":"Make a Test Video Gen run"}' \
    | jq -r '.run_ids[-1]'
)

python scripts/watch_run.py "$RUN_ID" \
  --api-url http://localhost:8080 \
  --api-key dev-local-api-key \
  --db-url "$DB_URL"
```

The watcher polls the API for status transitions and Postgres for new artifacts. Use `--summary-only` to print just status changes/final results or `--no-artifacts` to keep persona + provider chatter quiet while still monitoring health.

**Healthy Test Video Gen run output:**

```
🔍 Watching run: run_ff9c86fc
📍 API: http://localhost:8080
⏱️  Polling every 2.0s (Ctrl+C to stop)

[14:05:09] 📊 Status: pending
[14:05:11] 📦 RILEY: kieai.job (kieai) @ 2025-11-18T20:05:11.245Z
          └─ taskId: job-0
[14:05:12] 📦 RILEY: kieai.job (kieai) @ 2025-11-18T20:05:12.014Z
          └─ taskId: job-1
[14:05:14] 📦 RILEY: kieai.wait (kieai) @ 2025-11-18T20:05:14.512Z
          └─ status: completed (2/2)
[14:05:34] 📦 ALEX: shotstack.timeline (shotstack) @ 2025-11-18T20:05:34.884Z
          └─ clips: [0, 1]
[14:05:41] 📦 QUINN: publish.url (upload-post) @ 2025-11-18T20:05:41.120Z
[14:05:42] 📊 Status: completed

✅ Run finished with status: completed
🧭 Status transitions: pending → generating → editing → publishing → completed
📹 Videos: 2
   [0] published
   [1] published
🚀 Published:
   https://publish.mock/run_ff9c86fc/video
```

Keep the watcher open whenever you exercise the pipelines locally; it gives instant feedback before you need to dive into LangSmith or raw SQL.

**Persona tagging:** artifacts are now persisted with a `persona` column, so watcher lines always show which persona produced each artifact (e.g., `📦 RILEY: kieai.job`). If you see `SYSTEM` instead, the artifact came from the API or a HITL action instead of a persona agent.

`kieai.wait` artifacts (also tagged to Riley) indicate when the persona finished polling for clip readiness, making it obvious that both `submit_generation_jobs_tool` and `wait_for_generations_tool` executed.

### LangChain readiness log

When the orchestrator boots it logs `LangChain persona runtime configuration` with structured fields:

```
{"msg":"LangChain persona runtime configuration","langchain_available":true,"enable_langchain_personas":true,"providers_mode":"mock","environment":"local"}
```

Check this line after every `docker compose build`/`up` cycle (locally and on Fly) to ensure LangChain libraries are installed inside the containers and persona execution is enabled. If `langchain_available` is false, rebuild the images; if `enable_langchain_personas` is false, set `ENABLE_LANGCHAIN_PERSONAS=true` in your `.env` and restart.

---

## 1. LangSmith workflow observability

LangSmith is the primary place to inspect prompts, tool calls, and persona behavior.

1. Configure the environment:
   ```bash
   export LANGSMITH_API_KEY=...
   export LANGSMITH_PROJECT=myloware-dev
   ```
   Set these for both API and orchestrator processes.

2. Trigger a run via Brendan:
   ```bash
   curl -sS -H "x-api-key: $API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"user_id":"obs","message":"Make a Test Video Gen run about LangGraph"}' \
     http://localhost:8080/v1/chat/brendan
   ```

3. Open LangSmith and filter by project. You should see:
   - `brendan-chat` runs for each `/v1/chat/brendan` call.
   - `<project>-graph` runs (for example `test_video_gen-graph`, `aismr-graph`) tagged with the `run_id`.

4. When a HITL gate fires, the graph run pauses with an `awaiting_<gate>` state. After you approve the gate, the same run resumes and appends more spans.

Use LangSmith to:
- Confirm that persona prompts and tools are what you expect.
- Inspect how a specific run was routed through personas and gates.
- Compare mock vs live provider behavior under the same scenario.

### LangSmith Checklist

1. **Env vars in both services** – `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`, and `LANGSMITH_TRACING=true` must be visible inside both `api` and `orchestrator` containers (`docker compose exec <service> env | rg LANGSMITH`).
2. **Tags/metadata wired** – Every `<project>-graph` run carries tags `["graph", "<project>", "<run_id>"]` and metadata `{"run_id": "...", "project": "..."}`. Filter by those values to jump straight to the run you just started.
3. **Persona spans populated** – Expand a run and confirm iggy → riley → alex → quinn spans emit tool calls (mock adapters locally; live adapters on staging).
4. **Correlate with Postgres** – Cross-check the same `run_id` with `SELECT type, provider FROM artifacts WHERE run_id = '<id>'` so LangSmith spans match DB artifacts and run rows.
5. **Watcher parity** – `scripts/watch_run.py` output should match LangSmith status transitions for the same `run_id`.

If `LANGSMITH_API_KEY` is unset, the tracing hooks are effectively disabled; do not rely on LangSmith in that case.

---

## 2. Prometheus + Grafana

The API and orchestrator emit Prometheus metrics. Locally, `make up` brings up:
- Prometheus
- Grafana
- API (`:8080`)
- Orchestrator (`:8090`)

### 2.0 Strict startup prerequisites (staging/prod and strict local runs)

Fly deployments automatically enable `strict_startup_checks`. Flip the switch
locally with `STRICT_STARTUP_CHECKS=true` to mirror production. In strict mode
both services refuse to boot unless `/metrics` responds with HTTP 200.
Always verify `curl -sS https://<api-host>/metrics | head` and
`curl -sS https://<orchestrator-host>/metrics | head` after deploy; the startup probe hits the same
endpoints and will fail otherwise. Failed probes appear in the logs as “Metrics endpoint probe
failed”—fix those issues before rerunning.

### 2.1 Prometheus metrics

- API metrics: `http://localhost:8080/metrics`
- Orchestrator metrics: `http://localhost:8090/metrics`

Important series:
- `http_request_duration_seconds_bucket{service="api"}` – FastAPI request latency.
- `http_request_duration_seconds_bucket{service="orchestrator"}` – orchestrator request latency.
- `http_requests_total{service,route,status_code}` – request volume and error rates.
- `kieai_job_seconds`, `shotstack_render_seconds`, `ffmpeg_normalize_seconds`, `upload_post_seconds` – provider latency histograms.
- `kb_search_seconds{project,persona}` – pgvector retrieval latency captured for Brendan + persona memory searches.
- `mock_publish_seconds{project}` – end-to-end latency for mock publishing runs triggered via the API service.

In Grafana (see `infra/grafana/dashboards`), confirm:
- `/v1/chat/brendan` and `/v1/runs/start` have sensible P50/P95 latency.
- Error rates remain low for both API and orchestrator.
- Provider-specific panels are updating during pipeline runs.

---

## 3. Minimal SQL for debugging

While LangGraph handles coordination, a few tables are still helpful when debugging.

### 3.1 Runs

```sql
SELECT run_id,
       project,
       status,
       created_at,
       updated_at
FROM runs
ORDER BY created_at DESC
LIMIT 20;
```

### 3.2 Artifacts

```sql
SELECT type,
       provider,
       url,
       metadata,
       created_at
FROM artifacts
WHERE run_id = 'run_abc123'
ORDER BY created_at ASC;
```

### 3.3 Webhook events

```sql
SELECT provider,
       signature_status,
       received_at,
       headers ->> 'x-request-id' AS request_id
FROM webhook_events
WHERE run_id = 'run_abc123'
ORDER BY received_at ASC;
```

These queries help you answer:
- Did the run record correctly, and what status is it in?
- Which artifacts exist for the run (jobs, clips, normalized videos, publish URLs)?
- Were provider webhooks accepted, marked stale, or rejected?

---

## 4. SLOs and alerts

Suggested SLOs for the current stack:

- **Chat (`/v1/chat/brendan`)**
  - P95 latency < 2 seconds
  - Success rate ≥ 99% over 15 minutes

- **Run success**
  - ≥ 95% of mock runs reach `published` without manual intervention.

- **Live provider pipelines**
  - KieAI → Shotstack/FFmpeg → upload-post completes in < 30 seconds p95 for publish.

### 4.1 Automated SLO smoke test

Run `scripts/dev/check_slos.py` to exercise all three projects via Brendan, approve the
required HITL gates, and validate that the published metrics satisfy the SLOs above.

```bash
API_KEY=dev-local-api-key \
scripts/dev/check_slos.py \
  --api-base http://localhost:8080 \
  --orchestrator-base http://localhost:8090
```

The script will:

1. Trigger Test Video Gen and AISMR runs (mock providers by default).
2. Approve `workflow`, `ideate`, and `prepublish` gates for each run.
3. Scrape `/metrics` from the API and orchestrator.
4. Confirm:
   - Chat latency (`http_request_duration_seconds`) p95 < 2 seconds for `/v1/chat/brendan`.
   - Retrieval latency (`kb_search_seconds`) p95 < 0.5 seconds across personas.
   - Mock publish pipeline latency (`mock_publish_seconds`) p95 < 30 seconds.

The script exits non-zero if any gate approval fails, if runs time out, or if an SLO
threshold is exceeded. Integrate it into CI or pre-release smoke tests to block bad
deployments before they reach production.

Example alert ideas (Prometheus/Grafana):
- Error rate for `/v1/chat/brendan` or `/v1/runs/start` > 1% over 15 minutes.
- `kieai_job_seconds` or `upload_post_seconds` p95 above target for > 10 minutes.
- **Publish latency regression:** `histogram_quantile(0.95, sum(rate(upload_post_seconds_bucket[5m])) by (le)) > 45` for 10 minutes.
- **Webhook failures:** error rate for `/v1/webhooks/*` (4xx/5xx) > 1% over 30 minutes.
- **Tool error rate:** non-2xx responses from provider adapters (kie.ai, Shotstack, upload-post) > 5% over 15 minutes (combine Prometheus metrics and Sentry issue counts).

---

## 5. Quick local sanity checklist

Run this whenever you change observability or before demos:

1. `make up`
   - Confirm all containers are healthy (`docker compose ps`).
2. `make smoke`
   - Check `/health` and `/version` for low error rates.
3. Trigger a small Test Video Gen run via Brendan.
   - Verify LangSmith shows `brendan-chat` and `<project>-graph` runs.
   - Confirm metrics in Grafana update during the run.
   - Check logs for request IDs and run IDs.

If any of these checks fail, fix observability before making further changes—flying blind in production will cost more time later.
