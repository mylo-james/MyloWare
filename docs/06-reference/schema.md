# Database Schema Reference (Python Stack)

**Reference for the production PostgreSQL schema**  
**Last reviewed:** 2025-11-14

> ⚠️ This document is descriptive, not authoritative.  
> For the source of truth, inspect the Alembic migrations under
> `alembic/versions/` and the initial bootstrap migration.

---

## Overview

MyloWare uses PostgreSQL 15+ with the pgvector extension. The Python stack
defines its schema via Alembic migrations. The most important tables are:

- `runs` – run lifecycle and payload/result.
- `artifacts` – persona outputs, notifications, and RAG audit metadata.
- `webhook_events` – provider webhooks with signatures.
- `orchestration_checkpoints` – LangGraph state snapshots.
- `hitl_approvals` – HITL approval audit log.
- `kb_documents`, `kb_embeddings` – knowledge base storage.
- `socials`, `project_socials` – publish target configuration.

For higher‑level context, see [Data Model](../02-architecture/data-model.md).

---

## Inspecting the schema

To inspect the current schema in a running environment:

```bash
# From your machine (local or production bastion)
psql "$DB_URL" -c "\dt"
psql "$DB_URL" -c "\d+ runs"
psql "$DB_URL" -c "\d+ artifacts"
psql "$DB_URL" -c "\d+ webhook_events"
```

---

## Table definitions

### runs

```sql
CREATE TABLE runs (
  run_id     TEXT PRIMARY KEY,
  project    TEXT NOT NULL,
  status     TEXT NOT NULL,
  payload    JSONB,
  result     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

```

---

### artifacts

```sql
CREATE TABLE artifacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  url TEXT,
  provider TEXT,
  checksum TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  retrieval_trace JSONB,
  persona TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_artifacts_persona ON artifacts(persona);
```

Notes:

- `retrieval_trace` stores the structured RAG trace emitted by Brendan/persona memory searches and is always paired with a `citations` artifact in the `metadata` JSON payload.

---

### webhook_events

```sql
CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  idempotency_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  headers JSONB NOT NULL,
  payload BYTEA NOT NULL,
  signature_status TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE webhook_events
  ADD CONSTRAINT uq_webhook_events_idempotency
  UNIQUE (idempotency_key);
```

---

### webhook_dlq

```sql
CREATE TABLE webhook_dlq (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  idempotency_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  headers JSONB NOT NULL,
  payload BYTEA NOT NULL,
  error TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE webhook_dlq
  ADD CONSTRAINT uq_webhook_dlq_idempotency
  UNIQUE (idempotency_key, provider);

CREATE INDEX idx_webhook_dlq_next_retry
  ON webhook_dlq(next_retry_at);

CREATE INDEX idx_webhook_dlq_provider
  ON webhook_dlq(provider);
```

---

### orchestration_checkpoints

```sql
CREATE TABLE orchestration_checkpoints (
  run_id    TEXT PRIMARY KEY,
  state     JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### hitl_approvals

```sql
CREATE TABLE hitl_approvals (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL,
  gate TEXT NOT NULL,
  approver_ip TEXT,
  approver TEXT,
  metadata JSON,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hitl_approvals_run_id ON hitl_approvals(run_id);
```

---

### kb_documents

```sql
CREATE TABLE kb_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project TEXT,
  persona TEXT,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kb_documents_project_persona
  ON kb_documents(project, persona);
```

---

### kb_embeddings

```sql
CREATE TABLE kb_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  doc_id UUID NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  embedding VECTOR(1536)
);

CREATE INDEX idx_kb_embeddings_doc ON kb_embeddings(doc_id);

CREATE INDEX idx_kb_embeddings_cosine
  ON kb_embeddings
  USING ivfflat (embedding vector_cosine_ops);
```

> Note: pgvector requires the `vector` extension:
> `CREATE EXTENSION IF NOT EXISTS vector;`

---

### socials

```sql
CREATE TABLE socials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider TEXT NOT NULL,
  account_id TEXT NOT NULL,
  credential_ref TEXT,
  default_caption TEXT,
  default_tags JSONB,
  privacy TEXT,
  rate_limit_window INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### project_socials

```sql
CREATE TABLE project_socials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project TEXT NOT NULL,
  social_id UUID NOT NULL REFERENCES socials(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

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

---

## Migrations

MyloWare uses an **Alembic‑based incremental migration** approach:

- Migrations live under `alembic/versions/`.
- The baseline migration bootstraps tables like `runs`, `artifacts`,
  `webhook_events`, and `orchestration_checkpoints`.
- Subsequent migrations add tables (`socials`, `kb_*`, `hitl_approvals`) and
  columns (audit metadata on artifacts, webhook DLQ state, etc.).

Apply migrations in local Docker:

```bash
docker compose -f infra/docker-compose.yml run --rm api alembic upgrade head
```

Production (CI/CD or maintenance shell):

```bash
alembic upgrade head
```

---

## Further reading

- [Data Model](../02-architecture/data-model.md) – Architectural overview.
- [Run State and Checkpoints](../02-architecture/trace-state-machine.md) – Coordination details.
