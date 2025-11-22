# Data Model (Runs, Artifacts, and Webhooks)

**Audience:** Developers working with the database  
**Outcome:** Understand the core PostgreSQL schema used by the Python stack

---

## Overview

MyloWare uses PostgreSQL 15+ with the pgvector extension. The Python stack
tracks production runs, persona outputs, and provider webhooks using a small
set of tables managed by Alembic migrations.

This document focuses on the tables most relevant to day‑to‑day work:

- `runs` – one row per production run.
- `artifacts` – persona outputs, notifications, and RAG audit metadata.
- `webhook_events` – provider webhook payloads with signature status.
- `orchestration_checkpoints` – LangGraph state snapshots.
- `hitl_approvals` – HITL approval audit log.
- `kb_documents`, `kb_embeddings` – knowledge base storage.
- `socials`, `project_socials` – publishing targets per project.

For full DDL, see the Alembic migrations under `alembic/versions/` and the
Schema Reference in `docs/06-reference/schema.md`.

---

## Core tables

### runs

**Purpose:** Track run lifecycle and payloads.

Key columns (from `20251111_01_bootstrap_schema`):

| Column       | Type      | Description                              |
|-------------|-----------|------------------------------------------|
| `run_id`    | TEXT (PK) | Unique run identifier                    |
| `project`   | TEXT      | Project slug (`test_video_gen`, `aismr`) |
| `status`    | TEXT      | Run status (`pending_workflow`, `running`, `published`, `failed`, etc.) |
| `payload`   | JSONB     | Original request / workflow proposal     |
| `result`    | JSONB     | Final structured result for the run      |
| `created_at`| TIMESTAMPTZ | Creation time                          |
| `updated_at`| TIMESTAMPTZ | Last update                            |

Typical queries:

```sql
-- Most recent runs
SELECT run_id, project, status, created_at, updated_at
FROM runs
ORDER BY created_at DESC
LIMIT 20;

-- Count by status
SELECT status, COUNT(*) AS count
FROM runs
GROUP BY status;
```

---

### artifacts

**Purpose:** Store persona outputs, notifications, and RAG audit trails.

Key columns:

| Column            | Type      | Description |
|-------------------|-----------|-------------|
| `id`              | UUID (PK) | Artifact identifier |
| `run_id`          | TEXT      | Foreign key to `runs.run_id` |
| `type`            | TEXT      | Artifact type (`idea`, `script`, `clip`, `notification`, etc.) |
| `provider`        | TEXT      | Provider / subsystem (`brendan`, `iggy`, `shotstack`, `upload-post`, etc.) |
| `url`             | TEXT      | URL to external resource (video, publish URL) |
| `checksum`        | TEXT      | Optional checksum for idempotency |
| `persona`         | TEXT      | Persona responsible for this artifact |
| `retrieval_trace` | JSONB     | RAG audit trail (documents, scores, etc.) |
| `metadata`        | JSONB     | Additional structured metadata |
| `created_at`      | TIMESTAMPTZ | Creation time |

**Artifact payload conventions** (enforced by `apps/orchestrator/*` helpers):

- `retrieval.trace` artifacts capture `{ "query": "What is AISMR?", "docIds": ["..."], "similarities": [...], "persona": "brendan", "project": "aismr" }` along with sibling `citations` artifacts listing the KB file paths and reasons. `apps/orchestrator/rag_validation.py` ensures the citations align with the stored trace.

Typical queries:

```sql
-- All artifacts for a run
SELECT type, provider, url, metadata, created_at
FROM artifacts
WHERE run_id = 'run_abc123'
ORDER BY created_at ASC;

-- Persona-specific artifacts
SELECT run_id, type, url, created_at
FROM artifacts
WHERE persona = 'iggy'
ORDER BY created_at DESC
LIMIT 20;
```

---

### webhook_events

**Purpose:** Record inbound provider webhooks with idempotency and signature status.

Key columns:

| Column           | Type      | Description |
|------------------|-----------|-------------|
| `id`             | UUID (PK) | Event identifier |
| `idempotency_key`| TEXT      | Unique key for deduplication (e.g., `X-Request-Id`) |
| `provider`       | TEXT      | Provider name (`kieai`, `shotstack`, `upload-post`, etc.) |
| `headers`        | JSONB     | Request headers snapshot |
| `payload`        | BYTEA     | Raw request body (binary) |
| `signature_status`| TEXT     | `valid` / `invalid` / `missing` |
| `received_at`    | TIMESTAMPTZ | Receipt time |

Typical queries:

```sql
-- Recent webhook events
SELECT provider, signature_status, received_at
FROM webhook_events
ORDER BY received_at DESC
LIMIT 50;

-- Events with invalid signatures
SELECT provider, headers, received_at
FROM webhook_events
WHERE signature_status <> 'valid'
ORDER BY received_at DESC
LIMIT 20;
```

---

### webhook_dlq

**Purpose:** Persist webhook events that failed processing so they can be retried with exponential backoff.

Key columns:

| Column           | Type        | Description |
|------------------|-------------|-------------|
| `id`             | UUID (PK)   | DLQ entry identifier |
| `idempotency_key`| TEXT        | Stable key matching `webhook_events.idempotency_key` |
| `provider`       | TEXT        | Provider name (`kieai`, `upload-post`, etc.) |
| `headers`        | JSONB       | Original request headers snapshot |
| `payload`        | BYTEA       | Raw request body (binary) |
| `error`          | TEXT        | Last processing error message |
| `retry_count`    | INTEGER     | Number of replay attempts so far |
| `next_retry_at`  | TIMESTAMPTZ | When this entry should be attempted next (NULL = ready now) |
| `last_error_at`  | TIMESTAMPTZ | Timestamp of the last failure |
| `created_at`     | TIMESTAMPTZ | Creation time |
| `updated_at`     | TIMESTAMPTZ | Last metadata update time |

Typical queries:

```sql
-- Entries due for replay
SELECT id, provider, retry_count, next_retry_at
FROM webhook_dlq
WHERE next_retry_at IS NULL OR next_retry_at <= NOW()
ORDER BY created_at ASC
LIMIT 50;

-- Inspect the most common DLQ errors
SELECT provider, error, COUNT(*) AS occurrences
FROM webhook_dlq
GROUP BY provider, error
ORDER BY occurrences DESC
LIMIT 20;
```

---

### orchestration_checkpoints

**Purpose:** Store LangGraph state snapshots for each run.

Key columns:

| Column     | Type      | Description |
|-----------|-----------|-------------|
| `run_id`  | TEXT (PK) | Foreign key to `runs.run_id` |
| `state`   | JSONB     | Serialized LangGraph state    |
| `updated_at` | TIMESTAMPTZ | Last checkpoint time   |

This table allows the orchestrator to resume runs after restarts and to
inspect in‑flight state during debugging.

---

### hitl_approvals

**Purpose:** Audit log for HITL gate approvals.

Key columns:

| Column       | Type      | Description |
|-------------|-----------|-------------|
| `id`        | SERIAL PK | Approval row id |
| `run_id`    | TEXT      | Foreign key into `runs` |
| `gate`      | TEXT      | Gate name (`workflow`, `ideate`, `prepublish`) |
| `approver_ip`| TEXT     | IP address (if captured) |
| `approver`  | TEXT      | Approver identity (if captured) |
| `metadata`  | JSON      | Additional context |
| `created_at`| TIMESTAMPTZ | Approval time |

Typical query:

```sql
SELECT run_id, gate, approver, created_at
FROM hitl_approvals
ORDER BY created_at DESC
LIMIT 20;
```

---

### Knowledge base tables

#### kb_documents

**Purpose:** Store raw documents that feed the retrieval layer.

Key columns:

| Column    | Type      | Description |
|----------|-----------|-------------|
| `id`     | UUID (PK) | Document id |
| `project`| TEXT      | Optional project slug |
| `persona`| TEXT      | Optional persona name |
| `path`   | TEXT      | Source path (`docs/...`) |
| `content`| TEXT      | Raw document content |
| `created_at` | TIMESTAMPTZ | Ingestion time |

#### kb_embeddings

**Purpose:** Vector embeddings for `kb_documents`.

Key columns:

| Column         | Type      | Description |
|----------------|-----------|-------------|
| `id`          | UUID (PK) | Embedding row id |
| `doc_id`      | UUID      | Foreign key to `kb_documents.id` |
| `embedding`   | VECTOR(1536) | pgvector embedding |

The schema includes an approximate vector index for efficient similarity
search.

---

### Social publishing tables

#### socials

**Purpose:** Store social accounts (e.g., TikTok) used for publishing.

Key columns:

| Column           | Type      | Description |
|------------------|-----------|-------------|
| `id`             | UUID (PK) | Social account id |
| `provider`       | TEXT      | Provider slug (e.g., `tiktok`) |
| `account_id`     | TEXT      | Provider-specific account id |
| `credential_ref` | TEXT      | Reference to stored credentials |
| `default_caption`| TEXT      | Optional default caption |
| `default_tags`   | JSONB     | Optional default tags |
| `privacy`        | TEXT      | Privacy setting (provider-specific) |
| `rate_limit_window` | INT    | Rate limit window in seconds |
| `created_at`     | TIMESTAMPTZ | Creation time |

#### project_socials

**Purpose:** Link projects to social accounts.

Key columns:

| Column       | Type      | Description |
|-------------|-----------|-------------|
| `id`        | UUID (PK) | Link id |
| `project`   | TEXT      | Project slug |
| `social_id` | UUID      | Foreign key to `socials.id` |
| `is_primary`| BOOLEAN   | Whether this is the primary account |
| `created_at`| TIMESTAMPTZ | Creation time |

---

## Relationships

High‑level relationships:

```
runs
  ├─► artifacts.run_id
  ├─► orchestration_checkpoints.run_id
  └─► hitl_approvals.run_id

kb_documents
  └─► kb_embeddings.doc_id

socials
  └─► project_socials.social_id
```

In practice, most application queries pivot around `runs` and use `artifacts`
and `webhook_events` to reconstruct what happened during a pipeline.

---

## Migrations and source of truth

The schema is defined by Alembic migrations in the Python stack:

- Migrations live under `alembic/versions/`.
- `alembic.ini` configures the migration environment.

Apply migrations with:

```bash
docker compose -f infra/docker-compose.yml run --rm api alembic upgrade head
```

or, in CI / prod:

```bash
alembic upgrade head
```

For full DDL, see:

- [Schema Reference](../06-reference/schema.md)
