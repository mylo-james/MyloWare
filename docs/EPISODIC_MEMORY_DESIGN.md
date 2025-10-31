# Episodic Memory Schema & Retention Design

**Date:** October 30, 2025  
**Author:** MCP Prompts Team  
**Status:** Draft – supports Phase 2 · Step 2.2.1 of the modernization plan

---

## Objectives

- Provide a durable storage design for conversation history that keeps long-running agent sessions coherent.
- Balance rich retrieval signals (embedding-ready text, metadata) with storage costs and privacy requirements.
- Define indexing, retention, and summarisation policies that integrate cleanly with existing `prompt_embeddings` infrastructure and the new memory router.

---

## High-Level Architecture

```
┌─────────────────────┐        ┌──────────────────────────┐
│  conversation_turns │        │     prompt_embeddings     │
│  (raw transcript)   │        │ (episodic chunk entries)  │
├─────────────────────┤        ├──────────────────────────┤
│ id (uuid PK)        │◄──────►│ chunk_id (text, FK)       │
│ session_id (uuid)   │        │ memory_type='episodic'    │
│ user_id (text?)     │        │ embedding (vector)        │
│ role (enum)         │        │ metadata (jsonb)          │
│ content (text)      │        │ updated_at (timestamptz)  │
│ summary (jsonb)     │        └──────────────────────────┘
│ turn_index (int)    │
│ created_at (timestamptz)     Ingestion Flow:
│ updated_at (timestamptz)     1. Log turn into conversation_turns
│ metadata (jsonb)             2. Generate embedding + summary
└─────────────────────┘        3. Upsert prompt_embeddings row tagged episodic
```

- **conversation_turns** is the system of record for per-turn transcripts, ownership metadata, and retention controls.
- **prompt_embeddings** already supports `memory_type='episodic'`; each turn (or batched summary) is mirrored here for retrieval.
- Embedding payloads reference turns via `chunk_id = 'episodic::<session_id>::<turn_id>'`.

---

## Data Model Specification

### conversation_turns Table

| Column       | Type                     | Constraints                              | Notes                                              |
| ------------ | ------------------------ | ---------------------------------------- | -------------------------------------------------- |
| `id`         | `uuid`                   | Primary key, default `gen_random_uuid()` | Unique turn identifier.                            |
| `session_id` | `uuid`                   | Not null, indexed                        | Groups all turns under one agent session.          |
| `user_id`    | `text`                   | Nullable, indexed                        | Optional external principal (email, tenant id).    |
| `role`       | `conversation_role` enum | Not null                                 | Enum: `user`, `assistant`, `system`, `tool`.       |
| `turn_index` | `integer`                | Not null                                 | Monotonic sequence per session (0-based).          |
| `content`    | `text`                   | Not null                                 | Raw message text (pre-embedding).                  |
| `summary`    | `jsonb`                  | Nullable                                 | Optional structured summary (topic, action items). |
| `metadata`   | `jsonb`                  | Not null default `'{}'::jsonb`           | Free-form details (channel, locale, tags).         |
| `created_at` | `timestamptz`            | Not null default `now()`                 | Insert timestamp.                                  |
| `updated_at` | `timestamptz`            | Not null default `now()`                 | Modified timestamp (trigger-maintained).           |

#### Supporting Types

- `conversation_role` enum created with values `user`, `assistant`, `system`, `tool`.
- Future-proof for tool responses or system injections that should still be part of episodic recall.

#### Indices

- `idx_conversation_turns_session_created_at`: `(session_id, created_at)` for chronological session fetches.
- `idx_conversation_turns_user_created_at`: `(user_id, created_at DESC)` to support compliance lookups.
- `idx_conversation_turns_updated_at`: partial or general index for retention sweeps.
- GIN index on `metadata` for ad-hoc filters.

### prompt_embeddings (Episodic Rows)

- Reuse existing schema with `memory_type='episodic'`.
- Add partial index (already present from Step 2.1.2) ensures efficient filtering.
- Embedding ingestion logic MUST populate:
  - `metadata.session_id`
  - `metadata.turn_ids` (array) when chunk summarises multiple turns
  - `metadata.role`, `metadata.user_id` for targeted retrieval
  - `metadata.ttl_state` to flag summarised/archived status.

---

## Indexing & Query Patterns

1. **Session replay:** `SELECT * FROM conversation_turns WHERE session_id=$1 ORDER BY turn_index;`
2. **Recent history search:** filter by `session_id` + time window, optional role.
3. **User export/compliance:** `WHERE user_id=$1 AND created_at >= $2`.
4. **Hybrid retrieval:** memory router requests `memory_type='episodic'` chunks via existing repository search.
5. **Summarisation job:** find turns older than `SUMMARY_THRESHOLD_DAYS` but not yet summarised (`metadata->>'summary_state' = 'pending'`).

Indices created in this step cover #1-3; vector search leverages existing `prompt_embeddings` ivfflat / cosine indexes.

---

## Embedding & Summarisation Strategy

1. **Turn Ingestion**
   - On every message, append to `conversation_turns`.
   - Enqueue embedding job (synchronous for MVP, async recommended).
   - Use `text-embedding-3-small` (same as other components) for chunk embedding.
   - Populate prompt embedding row with `memory_type='episodic'`.

2. **Windowed Summaries**
   - Every `N` turns or `M` minutes, collapse recent turns into a summary entry.
   - Summary stored in `conversation_turns.summary` as JSON (title, action_items, sentiment).
   - Embedding row may represent summary with `metadata.turn_ids` covering range.

3. **Context Injection**
   - Retrieval strategy: prefer recent `turn_index` slices within session, fallback to summaries when outside context window.
   - Provide helper to assemble conversation snippet (ordered, deduped by turn id).

---

## Retention & Privacy

| Age         | Action        | Details                                                                   |
| ----------- | ------------- | ------------------------------------------------------------------------- |
| 0–30 days   | Full fidelity | Retain raw turns + embeddings.                                            |
| 31–90 days  | Summarise     | Replace granular turns with summary entries, keep key metadata.           |
| 91–180 days | Archive       | Move summaries to cold storage (optional), delete raw turns + embeddings. |
| >180 days   | Purge         | Hard-delete `conversation_turns` rows and associated episodic embeddings. |

- Add background job to enforce TTL using `created_at`.
- Allow per-user override via `metadata.retention_override` (e.g., legal hold).
- Ensure redaction pipeline can delete by `user_id` or `session_id` across both tables.

---

## Migration Plan (0004)

1. Create `conversation_role` enum.
2. Create `conversation_turns` table with schema above.
3. Add indexes: session/time, user/time, gin metadata.
4. Add trigger to keep `updated_at` in sync (reuse `updated_at` default or `UPDATED_AT` trigger).
5. No data backfill required initially.

Rollback: drop indexes, table, enum (if no rows), ensuring cascade is explicit to avoid dropping dependent data inadvertently.

---

## Implementation Checklist

- [ ] Generate SQL migration (`drizzle/0004_add_episodic_memory.sql`).
- [ ] Add Drizzle schema definitions + repository (Step 2.2.2).
- [ ] Implement ingestion pipeline + job orchestration (Step 2.2.2/2.2.4).
- [ ] Wire episodic component into memory router weighting (Step 2.2.3).
- [ ] Schedule retention & summarisation cron (Step 2.2.4).

---

## Open Questions

- Do we also persist tool call payloads? Option: store lightweight reference under `metadata.tool_call_id`.
- Should summarisation produce structured action items that feed procedural memory? (Potential future step.)
- Encryption at rest: rely on Postgres-level encryption? Evaluate column-level encryption for `content`.

---

## References

- Step 2.1.4 Memory Router implementation notes (`src/vector/memoryRouter.ts`).
- Prompt embeddings schema and migrations (`drizzle/0003_add_memory_components.sql`).
- Temporal scoring module for recency weighting (`src/vector/temporalScoring.ts`).
