# Database Schema Reference

**Last Updated:** November 7, 2025  
**Migration Policy:** Single squashed migration (`0000_initial_schema.sql`)

---

## Overview

The database uses PostgreSQL with the `pgvector` extension for vector similarity search. The schema enforces referential integrity via foreign keys, uses enums for status fields, and includes audit triggers for `updated_at` columns.

---

## Identifier Strategy

| Domain | Canonical Column | Type | Creator | Consumers | Notes |
| ------ | ---------------- | ---- | ------- | --------- | ----- |
| Project | `projects.id` | `uuid` | Seed data / admin tooling | `execution_traces` | Replace slug storage in trace tables; keep `projects.name` as human-readable alias |
| Session | `sessions.id` | `text` (external handle) | Upstream channel (Telegram/n8n) | `execution_traces`, `workflow_runs` | Keep text primary key, but enforce FK constraints everywhere |
| Trace | `execution_traces.trace_id` | `uuid` | `TraceRepository.create` | MCP tools, job tables, memories, workflow runs | Drop internal `execution_traces.id` exposure; all downstream FKs reference `trace_id` |
| Workflow Run | `workflow_runs.id` | `uuid` | Workflow execution tooling | Reporting, audits | Add optional `trace_id` FK if we retain workflow runs; otherwise plan deprecation |

**Key Principle:** Every referencing table stores the canonical identifier and enforces an FK to its source table.

---

## Enums

### `memory_type`
- `episodic`
- `semantic`
- `procedural`

### `trace_status`
- `active`
- `completed`
- `failed`

### `persona_name`
- `casey`
- `iggy`
- `riley`
- `veo`
- `alex`
- `quinn`

### `workflow_run_status`
- `running`
- `completed`
- `failed`
- `canceled`

### `http_method`
- `GET`
- `POST`
- `PUT`
- `DELETE`
- `PATCH`

### `auth_type_enum`
- `none`
- `header`
- `basic`
- `bearer`

### `job_status`
- `queued`
- `running`
- `succeeded`
- `failed`
- `canceled`

---

## Tables

### `personas`
AI identity configurations.

| Column | Type | Constraints | Notes |
| ------ | ---- | ----------- | ----- |
| `id` | `uuid` | PRIMARY KEY | Auto-generated |
| `name` | `text` | UNIQUE, NOT NULL | Persona identifier (e.g., "casey") |
| `description` | `text` | NOT NULL | Human-readable description |
| `capabilities` | `text[]` | NOT NULL | Array of capability strings |
| `tone` | `text` | NOT NULL | Communication tone |
| `default_project` | `text` | | Default project name |
| `system_prompt` | `text` | | System prompt template |
| `allowed_tools` | `text[]` | NOT NULL, DEFAULT `[]` | MCP tools this persona can use |
| `metadata` | `jsonb` | NOT NULL, DEFAULT `{}` | Additional configuration |
| `created_at` | `timestamp` | NOT NULL, DEFAULT `now()` | |
| `updated_at` | `timestamp` | NOT NULL, DEFAULT `now()` | Auto-updated via trigger |

**Indexes:**
- `personas_name_unique` (UNIQUE on `name`)

**Triggers:**
- `update_personas_updated_at` (BEFORE UPDATE)

---

### `projects`
Workflow collections and project configurations.

| Column | Type | Constraints | Notes |
| ------ | ---- | ----------- | ----- |
| `id` | `uuid` | PRIMARY KEY | Auto-generated |
| `name` | `text` | UNIQUE, NOT NULL | Project identifier (e.g., "aismr") |
| `description` | `text` | NOT NULL | Human-readable description |
| `workflow` | `text[]` | NOT NULL, DEFAULT `[]` | Workflow step names |
| `optional_steps` | `text[]` | NOT NULL, DEFAULT `[]` | Optional workflow steps |
| `guardrails` | `jsonb` | NOT NULL, DEFAULT `{}` | Project guardrails |
| `settings` | `jsonb` | NOT NULL, DEFAULT `{}` | Project settings |
| `metadata` | `jsonb` | NOT NULL, DEFAULT `{}` | Additional configuration |
| `created_at` | `timestamp` | NOT NULL, DEFAULT `now()` | |
| `updated_at` | `timestamp` | NOT NULL, DEFAULT `now()` | Auto-updated via trigger |

**Indexes:**
- `projects_name_unique` (UNIQUE on `name`)

**Triggers:**
- `update_projects_updated_at` (BEFORE UPDATE)

---

### `sessions`
Conversation state and session management.

| Column | Type | Constraints | Notes |
| ------ | ---- | ----------- | ----- |
| `id` | `text` | PRIMARY KEY | External session identifier |
| `user_id` | `text` | NOT NULL | User identifier |
| `persona` | `text` | NOT NULL | FK to `personas.name` |
| `project` | `text` | NOT NULL | FK to `projects.name` |
| `last_interaction_at` | `timestamp` | NOT NULL, DEFAULT `now()` | Last interaction timestamp |
| `expires_at` | `timestamp` | | TTL for session expiration |
| `context` | `jsonb` | NOT NULL, DEFAULT `{}` | Session context |
| `metadata` | `jsonb` | NOT NULL, DEFAULT `{}` | Additional session data |
| `created_at` | `timestamp` | NOT NULL, DEFAULT `now()` | |
| `updated_at` | `timestamp` | NOT NULL, DEFAULT `now()` | Auto-updated via trigger |

**Foreign Keys:**
- `sessions_persona_fk`: `persona` → `personas.name` (ON DELETE RESTRICT)
- `sessions_project_fk`: `project` → `projects.name` (ON DELETE RESTRICT)

**Indexes:**
- `sessions_user_idx` (on `user_id`)
- `sessions_expires_at_idx` (on `expires_at`)

**Triggers:**
- `update_sessions_updated_at` (BEFORE UPDATE)

---

### `execution_traces`
Trace coordination and agent handoff state machine.

| Column | Type | Constraints | Notes |
| ------ | ---- | ----------- | ----- |
| `id` | `uuid` | PRIMARY KEY | Internal ID (not exposed) |
| `trace_id` | `uuid` | UNIQUE, NOT NULL | Canonical trace identifier |
| `project_id` | `uuid` | NOT NULL | FK to `projects.id` |
| `session_id` | `text` | | FK to `sessions.id` |
| `current_owner` | `text` | NOT NULL, DEFAULT `'casey'` | FK to `personas.name` |
| `previous_owner` | `text` | | Previous persona |
| `instructions` | `text` | NOT NULL, DEFAULT `''` | Current instructions |
| `workflow_step` | `integer` | NOT NULL, DEFAULT `0` | Current workflow step (≥ 0) |
| `status` | `trace_status` | NOT NULL, DEFAULT `'active'` | Enum: active, completed, failed |
| `outputs` | `jsonb` | | Trace outputs |
| `created_at` | `timestamp` | NOT NULL, DEFAULT `now()` | |
| `updated_at` | `timestamp` | NOT NULL, DEFAULT `now()` | Auto-updated via trigger |
| `completed_at` | `timestamp` | | Completion timestamp |
| `metadata` | `jsonb` | NOT NULL, DEFAULT `{}` | Additional trace data |

**Foreign Keys:**
- `execution_traces_project_id_fk`: `project_id` → `projects.id` (ON DELETE RESTRICT)
- `execution_traces_session_id_fk`: `session_id` → `sessions.id` (ON DELETE SET NULL)
- `execution_traces_current_owner_fk`: `current_owner` → `personas.name` (ON DELETE RESTRICT)

**Check Constraints:**
- `execution_traces_workflow_step_non_negative`: `workflow_step >= 0`

**Indexes:**
- `execution_traces_trace_id_idx` (on `trace_id`)
- `execution_traces_status_idx` (on `status`)
- `execution_traces_current_owner_idx` (on `current_owner`)
- `execution_traces_created_at_idx` (on `created_at`)
- `execution_traces_status_project_idx` (partial: `status`, `project_id` WHERE `status = 'active'`)

**Triggers:**
- `update_execution_traces_updated_at` (BEFORE UPDATE)

---

### `workflow_runs`
Workflow execution tracking (legacy, may be deprecated).

| Column | Type | Constraints | Notes |
| ------ | ---- | ----------- | ----- |
| `id` | `uuid` | PRIMARY KEY | Auto-generated |
| `session_id` | `text` | | FK to `sessions.id` |
| `workflow_name` | `text` | NOT NULL | Workflow identifier |
| `status` | `workflow_run_status` | NOT NULL | Enum |
| `input` | `jsonb` | | Workflow input |
| `output` | `jsonb` | | Workflow output |
| `error` | `text` | | Error message if failed |
| `started_at` | `timestamp` | NOT NULL, DEFAULT `now()` | |
| `completed_at` | `timestamp` | | Completion timestamp |
| `metadata` | `jsonb` | NOT NULL, DEFAULT `{}` | Additional run data |
| `created_at` | `timestamp` | NOT NULL, DEFAULT `now()` | |

**Foreign Keys:**
- `workflow_runs_session_id_fk`: `session_id` → `sessions.id` (ON DELETE CASCADE)

**Check Constraints:**
- `workflow_runs_started_at_lte_completed_at`: `started_at <= completed_at OR completed_at IS NULL`

**Indexes:**
- `workflow_runs_session_idx` (on `session_id`)

---

### `memories`
Vector-embedded memories for semantic search.

| Column | Type | Constraints | Notes |
| ------ | ---- | ----------- | ----- |
| `id` | `uuid` | PRIMARY KEY | Auto-generated |
| `content` | `text` | NOT NULL | Memory content (single-line) |
| `summary` | `text` | | Memory summary (single-line) |
| `embedding` | `vector(1536)` | NOT NULL | OpenAI embedding vector |
| `memory_type` | `memory_type` | NOT NULL | Enum: episodic, semantic, procedural |
| `persona` | `text[]` | NOT NULL, DEFAULT `[]` | Associated personas |
| `project` | `text[]` | NOT NULL, DEFAULT `[]` | Associated projects |
| `tags` | `text[]` | NOT NULL, DEFAULT `[]` | Memory tags |
| `related_to` | `uuid[]` | NOT NULL, DEFAULT `[]` | Related memory IDs |
| `trace_id` | `uuid` | | FK to `execution_traces.trace_id` |
| `created_at` | `timestamp` | NOT NULL, DEFAULT `now()` | |
| `updated_at` | `timestamp` | NOT NULL, DEFAULT `now()` | Auto-updated via trigger |
| `last_accessed_at` | `timestamp` | | Last access timestamp |
| `access_count` | `integer` | NOT NULL, DEFAULT `0` | Access counter |
| `metadata` | `jsonb` | NOT NULL, DEFAULT `{}` | Additional memory data (includes `traceId` for back-compat) |

**Foreign Keys:**
- `memories_trace_id_fk`: `trace_id` → `execution_traces.trace_id` (ON DELETE SET NULL)

**Check Constraints:**
- `content_no_newlines`: `content !~ E'\n'`
- `summary_no_newlines`: `summary IS NULL OR summary !~ E'\n'`

**Indexes:**
- `memories_embedding_idx` (HNSW on `embedding` using `vector_cosine_ops`)
- `memories_memory_type_idx` (on `memory_type`)
- `memories_persona_idx` (GIN on `persona`)
- `memories_project_idx` (GIN on `project`)
- `memories_tags_idx` (GIN on `tags`)
- `memories_related_to_idx` (GIN on `related_to`)
- `memories_created_at_idx` (on `created_at`)
- `memories_trace_id_idx` (on `trace_id`)

**Triggers:**
- `update_memories_updated_at` (BEFORE UPDATE)

---

### `agent_webhooks`
n8n webhook configurations for agent handoffs.

| Column | Type | Constraints | Notes |
| ------ | ---- | ----------- | ----- |
| `id` | `uuid` | PRIMARY KEY | Auto-generated |
| `agent_name` | `text` | UNIQUE, NOT NULL | Agent identifier |
| `webhook_path` | `text` | NOT NULL | Webhook path |
| `method` | `http_method` | NOT NULL, DEFAULT `'POST'` | HTTP method enum |
| `auth_type` | `auth_type_enum` | NOT NULL, DEFAULT `'none'` | Auth type enum |
| `auth_config` | `jsonb` | NOT NULL, DEFAULT `{}` | Auth configuration |
| `description` | `text` | | Webhook description |
| `is_active` | `boolean` | NOT NULL, DEFAULT `true` | Active flag |
| `timeout_ms` | `integer` | | Timeout in milliseconds |
| `metadata` | `jsonb` | NOT NULL, DEFAULT `{}` | Additional config |
| `created_at` | `timestamp` | NOT NULL, DEFAULT `now()` | |
| `updated_at` | `timestamp` | NOT NULL, DEFAULT `now()` | Auto-updated via trigger |

**Indexes:**
- `agent_webhooks_agent_name_unique` (UNIQUE on `agent_name`)
- `agent_webhooks_agent_name_idx` (on `agent_name`)
- `agent_webhooks_is_active_idx` (on `is_active`)

**Triggers:**
- `update_agent_webhooks_updated_at` (BEFORE UPDATE)

---

### `video_generation_jobs`
Video generation job tracking.

| Column | Type | Constraints | Notes |
| ------ | ---- | ----------- | ----- |
| `id` | `uuid` | PRIMARY KEY | Auto-generated |
| `trace_id` | `uuid` | NOT NULL | FK to `execution_traces.trace_id` |
| `script_id` | `uuid` | | Script identifier |
| `provider` | `text` | NOT NULL | Provider name |
| `task_id` | `text` | NOT NULL | Provider task ID |
| `status` | `job_status` | NOT NULL, DEFAULT `'queued'` | Job status enum |
| `asset_url` | `text` | | Generated asset URL |
| `error` | `text` | | Error message if failed |
| `started_at` | `timestamp` | | Job start timestamp |
| `completed_at` | `timestamp` | | Job completion timestamp |
| `metadata` | `jsonb` | NOT NULL, DEFAULT `{}` | Additional job data |
| `created_at` | `timestamp` | NOT NULL, DEFAULT `now()` | |
| `updated_at` | `timestamp` | NOT NULL, DEFAULT `now()` | Auto-updated via trigger |

**Foreign Keys:**
- `video_generation_jobs_trace_id_fk`: `trace_id` → `execution_traces.trace_id` (ON DELETE CASCADE)

**Check Constraints:**
- `video_generation_jobs_completed_at_required`: `status NOT IN ('succeeded', 'failed') OR completed_at IS NOT NULL`
- `video_generation_jobs_started_at_lte_completed_at`: `started_at IS NULL OR completed_at IS NULL OR started_at <= completed_at`

**Indexes:**
- `video_generation_jobs_trace_idx` (on `trace_id`)
- `video_generation_jobs_status_idx` (on `status`)
- `video_generation_jobs_trace_status_idx` (on `trace_id`, `status`)
- `video_generation_jobs_provider_task_idx` (UNIQUE on `provider`, `task_id`)

**Triggers:**
- `update_video_generation_jobs_updated_at` (BEFORE UPDATE)

---

### `edit_jobs`
Edit/stitching job tracking.

| Column | Type | Constraints | Notes |
| ------ | ---- | ----------- | ----- |
| `id` | `uuid` | PRIMARY KEY | Auto-generated |
| `trace_id` | `uuid` | NOT NULL | FK to `execution_traces.trace_id` |
| `provider` | `text` | NOT NULL | Provider name |
| `task_id` | `text` | NOT NULL | Provider task ID |
| `status` | `job_status` | NOT NULL, DEFAULT `'queued'` | Job status enum |
| `final_url` | `text` | | Final edit URL |
| `error` | `text` | | Error message if failed |
| `started_at` | `timestamp` | | Job start timestamp |
| `completed_at` | `timestamp` | | Job completion timestamp |
| `metadata` | `jsonb` | NOT NULL, DEFAULT `{}` | Additional job data |
| `created_at` | `timestamp` | NOT NULL, DEFAULT `now()` | |
| `updated_at` | `timestamp` | NOT NULL, DEFAULT `now()` | Auto-updated via trigger |

**Foreign Keys:**
- `edit_jobs_trace_id_fk`: `trace_id` → `execution_traces.trace_id` (ON DELETE CASCADE)

**Check Constraints:**
- `edit_jobs_completed_at_required`: `status NOT IN ('succeeded', 'failed') OR completed_at IS NOT NULL`
- `edit_jobs_started_at_lte_completed_at`: `started_at IS NULL OR completed_at IS NULL OR started_at <= completed_at`

**Indexes:**
- `edit_jobs_trace_idx` (on `trace_id`)
- `edit_jobs_trace_status_idx` (on `trace_id`, `status`)
- `edit_jobs_provider_task_idx` (UNIQUE on `provider`, `task_id`)

**Triggers:**
- `update_edit_jobs_updated_at` (BEFORE UPDATE)

---

## Foreign Key Relationships

```
personas (name)
  ├── sessions.persona (RESTRICT)
  └── execution_traces.current_owner (RESTRICT)

projects (id)
  └── execution_traces.project_id (RESTRICT)

projects (name)
  └── sessions.project (RESTRICT)

sessions (id)
  ├── execution_traces.session_id (SET NULL)
  └── workflow_runs.session_id (CASCADE)

execution_traces (trace_id)
  ├── memories.trace_id (SET NULL)
  ├── video_generation_jobs.trace_id (CASCADE)
  └── edit_jobs.trace_id (CASCADE)
```

**ON DELETE Behaviors:**
- **RESTRICT**: Prevents deletion if referenced (e.g., projects with traces)
- **SET NULL**: Sets FK to NULL on deletion (e.g., traces when session deleted)
- **CASCADE**: Deletes dependent records (e.g., jobs when trace deleted)

---

## Triggers

### `update_updated_at_column()`
Function that sets `updated_at` to `now()` on UPDATE.

**Applied to:**
- `personas`
- `projects`
- `sessions`
- `execution_traces`
- `memories`
- `agent_webhooks`
- `video_generation_jobs`
- `edit_jobs`

**Note:** Repositories should NOT manually set `updated_at` - triggers handle it automatically.

---

## Migration Policy

- **Single Squashed Migration:** All schema changes are consolidated into `drizzle/0000_initial_schema.sql`
- **Legacy Migrations:** Archived in `drizzle/archive/`
- **No Incremental Migrations:** Schema changes require updating the squashed migration and regenerating

**To Apply Migrations:**
```bash
npm run db:bootstrap  # Reset + migrate + seed
npm run db:test:rollback  # Validate rollback safety
```

---

## Breaking Changes (Nov 7, 2025)

1. **`execution_traces.project_id`** now requires UUID (not text slug)
   - Use `ProjectRepository.findByName()` to lookup UUID before writing

2. **Status fields** now enforce enum values (no free-form text)
   - `execution_traces.status`: `trace_status` enum
   - `workflow_runs.status`: `workflow_run_status` enum
   - `agent_webhooks.method`: `http_method` enum
   - `agent_webhooks.auth_type`: `auth_type_enum` enum

3. **FK constraints** prevent orphaned records
   - All job tables require valid `trace_id`
   - Sessions require valid `persona` and `project` names

4. **`memories.trace_id`** column added (nullable, populated from metadata)
   - Backward compatibility: metadata still contains `traceId`
   - New code should populate `trace_id` column directly

5. **`updated_at` columns** now managed by triggers
   - Remove all manual `updated_at` writes from repositories

---

## Future Enhancements

- Partition `memories` table when volume demands
- Introduce junction tables if array triggers become costly
- Evaluate deprecation of `workflow_runs` once trace lifecycle fully replaces it
- Migrate `sessions.project` from text FK to UUID FK

