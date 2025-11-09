# Data Model

**Audience:** Developers working with the database  
**Outcome:** Understand MyloWare's database schema and relationships

---

## Overview

MyloWare uses PostgreSQL with the pgvector extension for hybrid vector + SQL storage.

**Auto-Generated Reference:** See [Schema Reference](../06-reference/schema.md) for complete field-level documentation (generated from `src/db/schema.ts`).

---

## Core Tables

### execution_traces
**Purpose:** Trace state machine for agent coordination

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `trace_id` | TEXT | Unique trace identifier (e.g., "trace-aismr-001") |
| `project_id` | TEXT | Project UUID or slug |
| `session_id` | TEXT | Session reference (e.g., "telegram:123") |
| `current_owner` | TEXT | Current persona (casey, iggy, riley, etc.) |
| `previous_owner` | TEXT | Previous persona (for history) |
| `workflow_step` | INTEGER | Position in project workflow array |
| `instructions` | TEXT | Natural language instructions for current owner |
| `status` | TEXT | active \| completed \| failed |
| `created_at` | TIMESTAMP | Trace creation time |
| `completed_at` | TIMESTAMP | Completion time (null if active) |
| `metadata` | JSONB | Additional context |

**Key Queries:**
```sql
-- Find active traces
SELECT * FROM execution_traces WHERE status = 'active';

-- Trace history
SELECT trace_id, current_owner, workflow_step, created_at 
FROM execution_traces 
WHERE trace_id = 'trace-001'
ORDER BY created_at DESC;
```

---

### memories
**Purpose:** Vector + relational memory storage

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `content` | TEXT | Single-line memory content |
| `summary` | TEXT | Auto-generated summary (if content > 100 chars) |
| `embedding` | VECTOR(1536) | OpenAI text-embedding-3-small |
| `memory_type` | ENUM | episodic \| semantic \| procedural |
| `persona` | TEXT[] | Personas associated (e.g., ['iggy']) |
| `project` | TEXT[] | Projects associated (e.g., ['aismr']) |
| `tags` | TEXT[] | Descriptive tags (e.g., ['ideas', 'approved']) |
| `related_to` | UUID[] | Linked memory IDs |
| `created_at` | TIMESTAMP | Creation time |
| `updated_at` | TIMESTAMP | Last update |
| `last_accessed_at` | TIMESTAMP | Last retrieval time |
| `access_count` | INTEGER | Retrieval frequency |
| `metadata` | JSONB | **Must include `traceId` for coordination** |

**Indices:**
- HNSW on `embedding` (vector similarity)
- GIN on `persona`, `project`, `tags` (array containment)
- Full-text on `content` (keyword search)

**Key Queries:**
```sql
-- Memories for a trace
SELECT persona, content, created_at 
FROM memories 
WHERE metadata->>'traceId' = 'trace-001'
ORDER BY created_at ASC;

-- Vector similarity search
SELECT content, 1 - (embedding <=> query_embedding) AS similarity
FROM memories
WHERE 1 - (embedding <=> query_embedding) > 0.7
ORDER BY similarity DESC
LIMIT 10;
```

---

### personas
**Purpose:** AI agent configuration

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | TEXT | Persona name (casey, iggy, riley, etc.) |
| `title` | TEXT | Display title (e.g., "Showrunner") |
| `system_prompt` | TEXT | Core identity (2-3 sentences) |
| `allowed_tools` | TEXT[] | MCP tools this persona can use |
| `guardrails` | JSONB | Behavioral constraints |
| `metadata` | JSONB | Additional config |

**Example:**
```json
{
  "name": "iggy",
  "title": "Creative Director",
  "system_prompt": "You are Iggy, the Creative Director. Generate unique, surreal ideas...",
  "allowed_tools": ["memory_search", "memory_store", "handoff_to_agent"],
  "guardrails": {
    "uniqueness_threshold": 0.85,
    "max_retries": 3
  }
}
```

---

### projects
**Purpose:** Production type configuration

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `slug` | TEXT | Project identifier (aismr, genreact) |
| `name` | TEXT | Display name |
| `description` | TEXT | Project overview |
| `workflow` | TEXT[] | Agent pipeline (e.g., ['casey', 'iggy', ...]) |
| `optional_steps` | TEXT[] | Skippable agents (e.g., ['alex']) |
| `specs` | JSONB | Project-specific requirements |
| `guardrails` | JSONB | Quality constraints |

**Example:**
```json
{
  "slug": "aismr",
  "workflow": ["casey", "iggy", "riley", "veo", "alex", "quinn"],
  "optional_steps": [],
  "specs": {
    "videoCount": 12,
    "videoDuration": 8.0,
    "compilationLength": 110
  }
}
```

---

### agent_webhooks
**Purpose:** Agent webhook registration for handoffs

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `agent_name` | TEXT | Persona name (unique) |
| `webhook_path` | TEXT | n8n webhook path (e.g., "/webhook/myloware/ingest") |
| `method` | TEXT | HTTP method (default: POST) |
| `auth_type` | TEXT | none \| header \| basic \| bearer |
| `auth_config` | JSONB | Auth credentials |
| `is_active` | BOOLEAN | Soft toggle |
| `timeout_ms` | INTEGER | Request timeout |
| `metadata` | JSONB | Integration hints |

---

### sessions
**Purpose:** Conversation state management

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `session_id` | TEXT | Unique session identifier |
| `user_id` | TEXT | User identifier with platform prefix |
| `persona` | TEXT | Active persona |
| `project` | TEXT | Active project |
| `context` | JSONB | Working memory |
| `conversation_history` | JSONB[] | Message history |
| `created_at` | TIMESTAMP | Session start |
| `updated_at` | TIMESTAMP | Last activity |

---

### Job Tracking Tables

#### video_generation_jobs
Tracks async video generation:
- `job_id` - External provider job ID
- `trace_id` - Associated trace
- `screenplay_id` - Source screenplay
- `status` - queued \| running \| succeeded \| failed
- `provider` - runway, shotstack, etc.
- `video_url` - Result URL (when succeeded)

#### edit_jobs
Tracks async video editing:
- `job_id` - External provider job ID
- `trace_id` - Associated trace
- `input_video_urls` - Source videos
- `status` - queued \| running \| succeeded \| failed
- `output_url` - Result URL (when succeeded)

---

## Relationships

```
execution_traces
  ├─► project_id → projects.id
  └─► session_id → sessions.session_id

memories
  ├─► persona[] → personas.name
  ├─► project[] → projects.slug
  ├─► related_to[] → memories.id
  └─► metadata.traceId → execution_traces.trace_id

agent_webhooks
  └─► agent_name → personas.name

video_generation_jobs
  └─► trace_id → execution_traces.trace_id

edit_jobs
  └─► trace_id → execution_traces.trace_id
```

---

## Memory Types

### Episodic
**Purpose:** Events, interactions, history  
**Retention:** Indefinite (with access decay)  
**Examples:**
- "User requested AISMR candles video"
- "Iggy generated 12 modifiers: Void, Liquid..."
- "Quinn published to TikTok: https://..."

### Semantic
**Purpose:** Facts, rules, specifications  
**Retention:** Indefinite (high importance)  
**Examples:**
- "AISMR videos must be exactly 8.0 seconds"
- "Whisper timing occurs at 3.0s mark"
- "Maximum 2 hands visible per scene"

### Procedural
**Purpose:** Workflows, processes, how-tos  
**Retention:** Indefinite (versioned)  
**Examples:**
- "Complete Video Production workflow"
- "AISMR Idea Generation process"
- "TikTok Publishing checklist"

---

## Trace Coordination Pattern

### Trace Lifecycle
```
1. trace_create()
   → execution_traces row created
   → status: 'active'
   → currentOwner: 'casey'

2. handoff_to_agent({ toAgent: 'iggy' })
   → currentOwner: 'iggy'
   → workflowStep: 1
   → previousOwner: 'casey'
   → Webhook invoked

3. Each agent:
   → memory_search({ traceId })
   → [work]
   → memory_store({ metadata: { traceId } })
   → handoff_to_agent({ toAgent: 'next' })

4. Quinn:
   → handoff_to_agent({ toAgent: 'complete' })
   → status: 'completed'
   → completedAt: NOW()
```

### Memory Tagging
Every memory created during a trace **must** include:
```typescript
metadata: {
  traceId: 'trace-001',  // REQUIRED for coordination
  // ... other fields
}
```

This enables:
- Agents to find upstream work
- Full execution graph reconstruction
- Trace-scoped debugging

---

## Indices and Performance

### Vector Search (HNSW)
```sql
CREATE INDEX memories_embedding_idx 
ON memories USING hnsw (embedding vector_cosine_ops);
```
- **Performance:** < 100ms for 10K+ memories
- **Trade-off:** Slower inserts, faster searches
- **Tuning:** `m=16, ef_construction=64` (default)

### Array Containment (GIN)
```sql
CREATE INDEX memories_persona_idx ON memories USING gin (persona);
CREATE INDEX memories_project_idx ON memories USING gin (project);
CREATE INDEX memories_tags_idx ON memories USING gin (tags);
```
- **Performance:** < 10ms for array filters
- **Use case:** `WHERE 'iggy' = ANY(persona)`

### Full-Text Search
```sql
CREATE INDEX memories_content_fts_idx 
ON memories USING gin (to_tsvector('english', content));
```
- **Performance:** < 50ms for keyword searches
- **Use case:** Exact phrase matching

---

## Migration Strategy

**Single Squashed Migration:**
- All schema in `drizzle/0000_initial_schema.sql`
- No incremental migrations
- Schema changes require updating squashed file

**Local Development:**
```bash
npm run db:reset -- --force  # Drop and recreate
npm run db:bootstrap -- --seed  # Migrate + seed
```

**Production:**
```bash
npm run db:migrate  # Apply squashed migration
```

See [Database Schema Reference](../06-reference/schema.md) for field-level details.

---

## Next Steps

- [Trace State Machine](trace-state-machine.md) - Coordination details
- [System Overview](system-overview.md) - High-level architecture
- [Schema Reference](../06-reference/schema.md) - Complete field docs

