# Run State and Checkpoints

**Audience:** Developers and operators  
**Outcome:** Understand how run status and LangGraph checkpoints are stored and inspected

---

## Overview

The original system used an `execution_traces` table as a generic state
machine. The Python stack replaces this with a simpler, run‑centric model:

- `runs` tracks high‑level lifecycle and payloads.
- `orchestration_checkpoints` stores LangGraph state snapshots.
- `artifacts` captures persona outputs and notifications.
- `webhook_events` and `hitl_approvals` record external signals.

This document explains how those tables fit together and how to reason about
run state.

---

## Run lifecycle

Every production run has a unique `run_id` and a `project` slug. The API
creates a row in `runs` and then the orchestrator drives state transitions
based on the LangGraph state graph and HITL gates.

Typical status values:

- `pending_workflow` – Brendan proposed a workflow; waiting for workflow HITL approval.
- `running` – Persona graph executing (between gates).
- `published` – Run completed successfully and all publish steps finished.
- `failed` – Run hit a non‑recoverable error.

Exact values are defined in the application code and the PRD; treat the
database as a representation of that state.

---

## Checkpoints

### Table: orchestration_checkpoints

When the orchestrator executes a state graph, it uses LangGraph checkpoints
to persist intermediate state. Checkpoints are stored in:

```sql
CREATE TABLE orchestration_checkpoints (
  run_id TEXT PRIMARY KEY,
  state  JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The `state` column contains the serialized LangGraph state (inputs, outputs,
and internal node state) for the most recent step.

**Usage:**
- Resume a run after orchestrator restarts.
- Inspect in‑flight state during debugging.

---

## Relating runs, artifacts, and checkpoints

The three most important tables for understanding a run are:

- `runs` – high‑level progress and payload/result.
- `artifacts` – persona outputs and notifications.
- `orchestration_checkpoints` – current LangGraph state.

Example inspection flow for a single run:

```sql
-- 1. Run status and payload/result
SELECT run_id, project, status, created_at, updated_at, payload, result
FROM runs
WHERE run_id = 'run_abc123';

-- 2. Current checkpoint (if any)
SELECT state, updated_at
FROM orchestration_checkpoints
WHERE run_id = 'run_abc123';

-- 3. Artifacts created so far
SELECT type, provider, persona, url, metadata, created_at
FROM artifacts
WHERE run_id = 'run_abc123'
ORDER BY created_at ASC;
```

This triad usually answers:

- Where is the run in the pipeline?
- What personas have already produced outputs?
- What was the last orchestrator state?

---

## HITL and approvals

HITL gates are reflected in both `runs` and `hitl_approvals`:

- When a gate is reached, the run typically pauses in a non‑terminal status
  (e.g., `pending_workflow`).
- When the gate is approved, an entry is inserted into `hitl_approvals` and
  the orchestrator resumes the run.

Example queries:

```sql
-- Recent approvals
SELECT run_id, gate, approver, approver_ip, created_at
FROM hitl_approvals
ORDER BY created_at DESC
LIMIT 20;

-- Runs that appear stuck
SELECT run_id, project, status, created_at,
       EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 AS minutes_running
FROM runs
WHERE status IN ('pending_workflow', 'running')
  AND created_at < NOW() - INTERVAL '30 minutes'
ORDER BY created_at ASC;
```

If approvals exist but runs do not resume, inspect the orchestrator logs for
resume failures keyed by `run_id`.

---

## Webhooks and external signals

Provider webhooks (kie.ai, Shotstack, upload-post) write into
`webhook_events` and often cause the orchestrator to advance runs or update
artifacts.

Example:

```sql
SELECT provider, signature_status, received_at
FROM webhook_events
ORDER BY received_at DESC
LIMIT 50;
```

You can correlate webhook events to runs using metadata in `artifacts` or
fields added in future migrations (e.g., a `run_id` field on
`webhook_events`).

---

## Best practices

1. **Treat application code as the source of truth** for status names and
   transitions; use the database for inspection and recovery, not for
   inventing new states.
2. **Prefer `runs` + `artifacts` + `orchestration_checkpoints`** when
   debugging; avoid inferring behaviour solely from logs.
3. **Use SQL sparingly in incident response** – read state, but make changes
   via the API or dedicated admin tooling wherever possible.
4. **Keep migrations additive and reversible** so you can roll forward or
   back without losing run history.

---

## Further reading

- [Data Model](data-model.md) – table‑level overview.
- [Schema Reference](../06-reference/schema.md) – detailed DDL.
- [Observability](../05-operations/observability.md) – tracing and metrics.

