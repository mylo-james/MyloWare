# Monitoring Dashboards

**Audience:** Operators and maintainers  
**Outcome:** Know which Grafana dashboards to use when validating a run end-to-end and diagnosing issues.

---

## 1. API Dashboard

**Purpose:** Track health of the FastAPI gateway (`apps/api`).

Key panels:

- **Traffic & Errors**
  - `http_requests_total{service="api"}` by `route` and `status_code`.
  - Error rate for:
    - `/v1/chat/brendan`
    - `/v1/runs/start`
    - `/v1/hitl/approve/*`
- **Latency**
  - `http_request_duration_seconds_bucket{service="api"}` filtered by route.
  - p50 / p95 latency for:
    - `/v1/chat/brendan`
    - `/v1/runs/start`
    - `/v1/webhooks/*`
    - `/v1/hitl/approve/*`
- **Rate Limiting**
  - Requests vs `429` responses on the same routes.
  - Correlate with Redis health when `USE_REDIS_RATE_LIMITING=true`.

During a test run, you should see:

- Spikes in `/v1/chat/brendan` and `/v1/runs/start` QPS.
- p95 latency comfortably below your SLO (e.g. <1s for chat, <2s for `/v1/runs/start`).

---

## 2. Orchestrator Dashboard

**Purpose:** Monitor the LangGraph orchestrator (`apps/orchestrator`).

Key panels:

- **Health & Latency**
  - `http_request_duration_seconds_bucket{service="orchestrator"}` for:
    - `/health`
    - `/runs/{run_id}`
    - `/v1/chat/brendan`
- **Run Lifecycle**
  - Custom panels that group traces/metrics by `run_id` and `project`:
    - Active runs (status `running`).
    - Runs awaiting HITL gate (`awaiting_gate` in state).
    - Completed runs.
- **Graph Execution Time**
  - Derived from LangSmith `<project>-graph` runs.
  - p95 graph duration per project.

Use this dashboard when:

- A run is stuck in `pending_workflow` or `running`.
- HITL approvals do not appear to resume the graph.

---

## 3. Provider Dashboards (kie.ai, Shotstack, Upload-Post)

**Purpose:** Understand behaviour and latency of external providers.

Important histograms (from API service):

- `kieai_job_seconds` – time to submit a kie.ai job.
- `shotstack_render_seconds` – wall-clock time from render request to completion.
- `ffmpeg_normalize_seconds` – FFmpeg normalization time.
- `upload_post_seconds` – upload-post publish latency.

Recommended panels:

- **Latency heatmaps** per provider.
- **Error rates** per provider (HTTP status/code breakdown).
- **Throughput** – jobs submitted per run and per time window.

During a Test Video Gen or AISMR run you should see:

- Two kie.ai jobs for Test Video Gen.
- Twelve jobs for AISMR runs.
- Corresponding Shotstack and Upload-Post calls when not in mock mode.

---

## 4. Webhook & DLQ Dashboard

**Purpose:** Track inbound webhooks and retries.

Although the DLQ implementation is separate, you should have panels for:

- `webhook_events` table:
  - Count of events per provider and `signature_status`.
  - Recent events with invalid signatures or duplicates.
- Webhook handler latency:
  - Derived from FastAPI metrics for `/v1/webhooks/*`.
- Failure rate:
  - 4xx/5xx rates in webhook handlers.

Use this dashboard when:

- Runs remain in `running` or `publishing` longer than expected.
- You suspect missing or duplicated webhooks.

---

## 5. How to Use Dashboards During a Run

1. Start a run via Brendan (chat API or Telegram).
2. Open the **API** dashboard:
   - Verify `/v1/chat/brendan` and `/v1/runs/start` traffic and latency.
3. Switch to the **Orchestrator** dashboard:
   - Confirm the run appears with the expected `project` and that the graph reaches a HITL gate or completion.
4. Inspect the **Provider** dashboards:
   - Ensure jobs/renders/publishes track with the run’s lifecycle.
5. If anything looks off:
   - Use the **Webhook** dashboard and the production runbook to trace webhook deliveries and errors.
