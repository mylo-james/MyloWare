# V2 Architecture

> **Simple by Design: One Agent, Three Services**

---

## Overview

V2 is built on three principles:

1. **Semantic Discovery** - Find workflows by understanding intent, not matching strings
2. **Agentic RAG** - Agent decides when and what to retrieve
3. **Memory as State** - Everything is remembered and searchable

---

## The Stack

```
┌─────────────────────────────────────────────────┐
│                   USER                          │
│              (Telegram / API)                   │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│              n8n WORKFLOWS                      │
│  ┌───────────────────────────────────────────┐ │
│  │  Agent Workflow (Main)                    │ │
│  │  • Single AI agent node                   │ │
│  │  • GPT-4o-mini                            │ │
│  │  • MCP tool calling                       │ │
│  │  • Conversation management                │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │  Programmatic Workflows (Future)          │ │
│  │  • Video generation queue                 │ │
│  │  • TikTok publishing                      │ │
│  │  • Batch processing                       │ │
│  └───────────────────────────────────────────┘ │
└────────────────────┬────────────────────────────┘
                     │
                     ▼ HTTP (MCP Protocol)
┌─────────────────────────────────────────────────┐
│              MCP SERVER                         │
│                                                 │
│  Tool Registry (10 tools)                      │
│  ├── memory_search      (hybrid vector + keyword) │
│  ├── memory_store       (with auto-linking)   │
│  ├── memory_evolve      (update existing)     │
│  ├── context_get_persona                       │
│  ├── context_get_project                       │
│  ├── trace_create      (Epic 1: coordination)│
│  ├── handoff_to_agent  (Epic 1: n8n webhooks)│
│  ├── workflow_complete (Epic 1: completion)  │
│  ├── session_get_context                       │
│  └── session_update_context                    │
│                                                 │
│  Features:                                     │
│  • Zod validation                              │
│  • Request ID tracking                         │
│  • Prometheus metrics                          │
│  • Health checks                               │
│  • Error handling + retry                     │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│         POSTGRES (with pgvector)                │
│                                                 │
│  Vector Database:                              │
│  └── memories table                            │
│      ├── content (text)                        │
│      ├── embedding (vector(1536))              │
│      ├── memoryType (enum)                     │
│      ├── persona[], project[], tags[]          │
│      ├── relatedTo[] (memory links)            │
│      └── metadata (jsonb)                      │
│                                                 │
│  SQL Database:                                 │
│  ├── personas (AI identity configs)            │
│  ├── projects (workflow collections)          │
│  ├── sessions (conversation state)            │
│  ├── execution_traces (trace coordination)    │
│  ├── workflow_runs (legacy workflow tracking)  │
│  ├── memories (vector + relational)            │
│  ├── agent_webhooks (agent webhook configs)   │
│  ├── video_generation_jobs (job tracking)     │
│  └── edit_jobs (job tracking)                 │
│                                                 │
│  Schema Features:                              │
│  ├── Foreign keys (referential integrity)     │
│  ├── Enums (status field validation)           │
│  ├── Triggers (auto-update updated_at)         │
│  └── Check constraints (state machine rules)  │
│                                                 │
│  Indices:                                      │
│  ├── HNSW (vector similarity)                  │
│  ├── GIN (array containment)                   │
│  ├── Full-text (keyword search)                │
│  └── Covering indexes (hot query optimization)│
└─────────────────────────────────────────────────┘
```

---

## Universal Workflow Pattern

V2 uses a **single universal workflow** (`myloware-agent.workflow.json`) that becomes any persona dynamically based on trace state. This eliminates the need for separate workflow files per agent.

### Workflow Structure

```
┌─────────────────────────────────────────────────────┐
│  myloware-agent.workflow.json (ONE FILE)           │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────┐   ┌─────────────┐   ┌──────────┐ │
│  │  Telegram   │   │    Chat     │   │ Webhook  │ │
│  │  Trigger    │   │   Trigger   │   │ Trigger  │ │
│  └──────┬──────┘   └──────┬──────┘   └────┬─────┘ │
│         │                  │               │       │
│         └──────────────────┴───────────────┘       │
│                            ↓                       │
│                  ┌──────────────────┐              │
│                  │   Edit Fields    │              │
│                  ├──────────────────┤              │
│                  │ Extract traceId  │              │
│                  │ Normalize inputs │              │
│                  └────────┬─────────┘              │
│                           ↓                        │
│                  ┌──────────────────┐              │
│                  │   trace_prep     │              │
│                  │   (HTTP Request) │              │
│                  ├──────────────────┤              │
│                  │ ONE call that:   │              │
│                  │ • Creates trace  │              │
│                  │   if missing     │              │
│                  │ • Loads persona  │              │
│                  │ • Gets project   │              │
│                  │ • Searches memory│              │
│                  │ • Builds prompt  │              │
│                  │ • Returns tools  │              │
│                  └────────┬─────────┘              │
│                           ↓                        │
│                  ┌──────────────────┐              │
│                  │   AI Agent Node  │              │
│                  ├──────────────────┤              │
│                  │ Prompt: {{prep}} │              │
│                  │ Tools: {{tools}} │              │
│                  │                  │              │
│                  │ Personifies:     │              │
│                  │ • Casey          │              │
│                  │ • Iggy           │              │
│                  │ • Riley          │              │
│                  │ • Veo            │              │
│                  │ • Alex           │              │
│                  │ • Quinn          │              │
│                  │                  │              │
│                  │ Calls tools:     │              │
│                  │ • memory_store   │              │
│                  │ • handoff_to_agent│             │
│                  └────────┬─────────┘              │
│                           ↓                        │
│              (Handoff updates DB & invokes        │
│               SAME workflow via webhook)           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Data Flow

### 1. Message Arrives

```
User: "Create an AISMR video about rain sounds"
  │
  ▼
Telegram Webhook → myloware-agent.workflow.json
  │
  ▼
Edit Fields Node
  │
  ├─► Extracts: { traceId: null, sessionId: "telegram:123", message: "..." }
  │
  ▼
trace_prep HTTP Request (POST /mcp/trace_prep)
  │
  ├─► No traceId → Creates new trace
  │   └─► traceId: "trace-aismr-001", currentOwner: "casey", projectId: "unknown"
  │
  ├─► Loads persona: Casey
  │
  ├─► Builds Casey init prompt (project selection mode)
  │
  ├─► Returns: { systemPrompt, allowedTools, traceId, instructions }
  │
  ▼
AI Agent Node (becomes Casey)
  │
  ├─► Receives complete systemPrompt from trace_prep
  ├─► Has access to: trace_update, memory_search, memory_store, handoff_to_agent
  │
  ├─► Determines project = "aismr"
  ├─► Calls trace_update({ traceId, projectId: "550e8400-e29b-41d4-a716-446655440000" }) // Project UUID
  ├─► Stores kickoff memory
  └─► Calls handoff_to_agent({ traceId, toAgent: "iggy", instructions: "..." })
  │
      ├─► Updates trace: currentOwner = "iggy", workflowStep = 1
      ├─► Stores handoff memory
      └─► Invokes webhook: POST /webhook/myloware/ingest { traceId }
          │
          ▼
          SAME workflow receives webhook
          │
          ▼
          trace_prep HTTP Request (with traceId)
          │
          ├─► Loads existing trace
          ├─► Finds currentOwner = "iggy"
          ├─► Loads persona: Iggy
          ├─► Loads project: AISMR
          ├─► Searches memories by traceId
          ├─► Builds Iggy prompt with context
          └─► Returns: { systemPrompt, allowedTools, traceId, instructions }
              │
              ▼
              AI Agent Node (becomes Iggy)
              │
              └─► ... (continues through all agents)
```

### 3. Multi-Agent Workflow Executes

```
Iggy (Creative Director)
  │
  ├─► Loads context (persona + project)
  ├─► Searches memory by traceId
  ├─► Generates 12 surreal modifiers
  ├─► Stores to memory (tagged with traceId)
  ├─► HITL: Telegram "Send and Wait" for approval
  └─► Hands off to Riley via handoff_to_agent
  │
  ▼
Riley (Head Writer)
  │
  ├─► Searches memory for Iggy's modifiers
  ├─► Writes 12 validated screenplays (8s each)
  ├─► Stores to memory (tagged with traceId)
  └─► Hands off to Veo via handoff_to_agent
  │
  ▼
Veo (Production - n8n workflow)
  │
  ├─► Generates 12 videos in parallel
  ├─► Validates duration and quality
  ├─► Stores video URLs to memory
  └─► Hands off to Alex via handoff_to_agent
  │
  ▼
Alex (Editor)
  │
  ├─► Downloads 12 videos
  ├─► Edits compilation with transitions
  ├─► HITL: Telegram approval before upload
  └─► Hands off to Quinn via handoff_to_agent
  │
  ▼
Quinn (Social Media Manager)
  │
  ├─► Creates optimized caption + hashtags
  ├─► Uploads to TikTok
  ├─► Stores post URL to memory
  └─► Calls workflow_complete(traceId, "completed")
```

### 4. Memory Stored

```
memory_store({
  content: "Generated AISMR video 'Gentle Rain'...",
  memoryType: "episodic",
  project: ["aismr"],
  tags: ["video-complete", "tiktok-published"]
})
  │
  ▼
Stored in Postgres with:
  • Vector embedding (for semantic search)
  • Full-text index (for keyword search)
  • Links to related memories
  • Auto-generated summary
```

---

## Trace-Based Coordination

V2 uses a trace-based coordination model where a single universal workflow (`myloware-agent.workflow.json`) becomes any persona dynamically. The `execution_traces` table serves as the state machine that coordinates agent handoffs.

### Trace State Machine

The `execution_traces` table tracks:
- `traceId` - Unique identifier for the production run
- `currentOwner` - Which persona currently owns the trace (casey, iggy, riley, veo, alex, quinn)
- `workflowStep` - Position in the project's workflow array
- `instructions` - What the current owner should do
- `status` - active | completed | failed
- `projectId` - Which project (defines workflow order)

### Agent Self-Discovery

When the universal workflow receives a webhook with `{ traceId }`:

1. Calls `trace_prep` HTTP endpoint with `traceId`
2. `trace_prep` loads trace and finds `currentOwner`
3. `trace_prep` loads persona config for `currentOwner`
4. `trace_prep` loads project config
5. `trace_prep` searches memories by `traceId`
6. `trace_prep` builds complete system prompt
7. `trace_prep` returns `allowedTools` for that persona
8. AI Agent node receives prompt and tools, becomes that persona

### Data Flow: Trace Create → Handoff → Complete

```
User sends message → myloware-agent workflow
  │
  ▼
trace_prep HTTP endpoint (no traceId)
  │
  ├─► Creates execution_traces row
  │   └─► traceId: "trace-aismr-001", currentOwner: "casey", projectId: "unknown"
  │
  ├─► Loads persona: Casey
  ├─► Builds Casey init prompt
  └─► Returns: { systemPrompt, allowedTools, traceId }
  │
  ▼
AI Agent (becomes Casey)
  │
  ├─► Determines project = "aismr"
  ├─► Calls trace_update({ traceId, projectId: "550e8400-e29b-41d4-a716-446655440000" }) // Project UUID
  ├─► Stores kickoff memory
  └─► Calls handoff_to_agent({ traceId, toAgent: "iggy", instructions: "..." })
  │
      ├─► Updates trace: currentOwner = "iggy", workflowStep = 1
      ├─► Stores handoff memory (tagged with traceId)
      └─► Invokes webhook: POST /webhook/myloware/ingest { traceId }
          │
          ▼
          SAME workflow receives webhook
          │
          ▼
          trace_prep HTTP endpoint (with traceId)
          │
          ├─► Loads trace, finds currentOwner = "iggy"
          ├─► Loads persona: Iggy
          ├─► Loads project: AISMR
          ├─► Searches memories by traceId
          └─► Returns: { systemPrompt, allowedTools, traceId }
  │
  ▼
              AI Agent (becomes Iggy)
  │
              ├─► Searches memory by traceId for context
  ├─► Generates outputs
  ├─► Stores outputs to memory (tagged with traceId)
              └─► Hands off to next agent via handoff_to_agent
  │
  ▼
... (chain continues through all agents)
  │
  ▼
                  Quinn calls handoff_to_agent({ toAgent: "complete", ... })
  │
                  ├─► Updates trace: status = "completed", currentOwner = "complete"
                  ├─► Stores completion memory
                  ├─► Sends Telegram notification to user
                  └─► Returns (no webhook invoked)
```

### Special Handoff Targets

- `toAgent: "complete"` → Sets trace status = 'completed', sends user notification, no webhook invoked
- `toAgent: "error"` → Sets trace status = 'failed', no webhook invoked

### Key Concepts

**Execution Traces (`execution_traces` table):**

- Each production run has a unique `traceId` (UUID)
- Tracks status: `active`, `completed`, `failed`
- Stores project context, session reference, and final outputs
- All memories created during the run are tagged with `traceId` for discovery

**Agent Webhooks (`agent_webhooks` table):**

- Maps agent names (casey, iggy, riley, veo, alex, quinn) to n8n webhook paths
- Configures authentication (none, header, basic, bearer)
- Stores timeout and metadata per agent
- Supports soft toggles via `isActive` flag

**Memory Tagging:**

- All memories created during a trace include `traceId` in metadata
- Agents search memory by `traceId` to find prior outputs
- Enables autonomous coordination without central state management
- Full execution graph is reconstructable from memory

**Workflow Metadata:**

- Procedural memories that describe workflows must store the backing n8n workflow ID in `metadata.n8nWorkflowId`.
- The workflow/prompt execution helpers read that metadata (or accept an explicit `n8nWorkflowId` override) and delegate to n8n without relying on a separate registry table.
- Scripts such as `scripts/db/seed-workflows.ts` and `scripts/register-workflow-mappings.ts` ensure these metadata fields stay up to date.

### MCP Tools

**`trace_create`:**

- Creates a new execution trace
- Parameters: `projectId` (required), `sessionId` (optional), `metadata` (optional)
- Returns: `traceId`, `status`, `createdAt`

**`trace_prepare`:**

- Creates a new trace when no `traceId` is supplied, or loads the existing one when it is.
- Bundles persona + project guardrails, retrieves recent trace-scoped memories, builds the final system prompt, and scopes the MCP tool list for the active owner.
- Parameters: `traceId?`, `instructions?`, `sessionId?`, `source?`, `metadata?`, `memoryLimit?`
- Returns: `{ trace, systemPrompt, allowedTools, memories, instructions, justCreated }`

**`trace_update`:**

- Updates existing trace fields after Casey normalizes the user request
- Parameters: `traceId` (required), plus any of `projectId`, `instructions`, `metadata`
- Returns: Updated trace record

**`handoff_to_agent`:**

- Hands off work to another agent via n8n webhook
- Parameters: `traceId` (required), `toAgent` (required), `instructions` (required), `metadata` (optional)
- Validates trace is active and agent webhook exists (unless `toAgent` is a terminal target)
- Updates the trace ledger (`previousOwner`, `currentOwner`, `instructions`, `workflowStep`) before invoking downstream work
- Invokes n8n webhook and stores the handoff event to memory
- Special targets:
  - `complete` → marks the trace `completed`, sets `currentOwner='complete'`, stores the completion memory, skips webhook invocation
  - `error` → marks the trace `failed`, sets `currentOwner='error'`, stores the incident summary, skips webhook invocation
- Returns: `webhookUrl`, `executionId`, `status`, `toAgent` for normal handoffs or `{ traceId, status, toAgent }` for terminal targets

**`workflow_complete`:**

- Marks a workflow trace as completed or failed
- Parameters: `traceId` (required), `status` (required: 'completed' | 'failed'), `outputs` (optional), `notes` (optional)
- Updates trace status and stores completion event to memory
- Returns: `traceId`, `status`, `completedAt`, `outputs`

### Benefits

1. **Decentralized Coordination:** Agents coordinate via memory, not central state
2. **Observability:** Full execution trace reconstructable from memory searches
3. **Simplicity:** Three tools replace complex run_state and handoff machinery
4. **Fail-Fast:** Invalid traces or inactive agents error immediately
5. **Memory-First:** Coordination happens through tagged memories, enabling semantic discovery

---

## Key Components

### MCP Server

**Purpose:** Tool interface between agent and database

**Technology:**

- Fastify (HTTP server)
- @modelcontextprotocol/sdk
- Drizzle ORM
- OpenAI API

**Responsibilities:**

- Tool registration and validation
- Parameter validation (Zod schemas)
- Database queries (repositories)
- OpenAI API calls (embeddings, summarization)
- Metrics collection (Prometheus)
- Error handling and retry logic

**Endpoints:**

- `POST /mcp` - MCP tool calls
- `GET /health` - Health check
- `GET /metrics` - Prometheus metrics

### n8n Agent

**Purpose:** AI agent orchestration and workflow execution

**Configuration:**

- Single agent node with GPT-4o-mini
- MCP client for tool calling
- System prompt (agentic RAG pattern)
- Telegram integration
- Tool workflow nodes for programmatic workflows

**n8n Integration:**

- **MCP Server:** Provides tools via HTTP endpoint (`/mcp`)
- **Authentication:** Optional `x-api-key` header (when `MCP_AUTH_KEY` configured)
- **Tool Calling:** n8n MCP Client node calls MCP tools synchronously
- **Workflow Delegation:** `workflow_execute` tool delegates to n8n API for execution
- **Programmatic Workflows:** Edit_AISMR and Generate Video workflows callable via `toolWorkflow` nodes

**Decision Process:**

1. Understand user intent
2. Load context (persona, project) via MCP tools
3. Search memory for relevant information
4. Create trace for multi-agent workflows (trace_create)
5. Hand off to specialist agents via webhooks (handoff_to_agent)
6. Wait for workflow completion signal (workflow_complete)
7. Store interaction in memory

**Programmatic Workflows:**

- **Edit_AISMR:** Takes 12 videos, builds Shotstack edit JSON, renders final video
- **Generate Video:** Takes idea, generates video via Veo 3 Fast API
- These workflows are pure n8n (no AI) and are exposed as tools via `toolWorkflow` nodes

### Postgres + pgvector

**Purpose:** Vector + SQL database

**Vector Capabilities:**

- 1536-dimensional embeddings (OpenAI text-embedding-3-small)
- HNSW indices for fast similarity search
- Cosine distance operator (<=>)

**SQL Capabilities:**

- State tracking (sessions, workflow runs)
- Configuration storage (personas, projects)
- Full-text search (PostgreSQL tsvector)

### Developer Test Harness

The Vitest harness now provisions its own Postgres automatically, eliminating the “which port is Postgres on?” problem and keeping schema/seed data in sync.

- `tests/setup/env.ts`
  - Detects Colima (`~/.colima/default/docker.sock`) and Docker Desktop (`~/.docker/run/docker.sock`) sockets and exports `DOCKER_HOST`/`TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE`.
  - When `TEST_DB_USE_CONTAINER=1`, clears any `.env` `POSTGRES_PORT` so Drizzle won’t rewrite the dynamic port Testcontainers selects.
  - Falls back to the local reusable DB (`postgresql://test:test@127.0.0.1:6543/mcp_v2_test`) when containers are disabled.
- `tests/setup/database.ts`
  - Starts `pgvector/pgvector:pg16`, captures the mapped host port, and calls `resetDbClient()` so the shared pool points to the disposable database.
  - Runs migrations + base seed data before each suite and tears the container down after.
- Preferred command (CI + local): `TEST_DB_USE_CONTAINER=1 LOG_LEVEL=warn npx vitest run tests/unit`

Developers who still want a persistent test DB can export `TEST_DB_URL` and use `npm run test:unit:local` (see `DEV_GUIDE.md`), but the containerized flow keeps the default path deterministic and conflict-free.

**Memory Schema:**

```sql
CREATE TABLE memories (
  id UUID PRIMARY KEY,
  content TEXT NOT NULL,
  summary TEXT,
  embedding vector(1536) NOT NULL,
  memory_type memory_type NOT NULL,
  persona TEXT[] DEFAULT '{}',
  project TEXT[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  related_to UUID[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_accessed_at TIMESTAMP,
  access_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'
);

-- HNSW index for vector similarity
CREATE INDEX ON memories USING hnsw (embedding vector_cosine_ops);

-- Full-text search
CREATE INDEX ON memories USING GIN (to_tsvector('english', content));
```

---

## Memory System

### Three Memory Types

1. **Episodic** - Personal, temporal, contextual
   - User conversations
   - Workflow executions
   - Past interactions
   - Example: "User asked for rain video on Nov 6"

2. **Semantic** - Factual, timeless, universal
   - Project specs and guardrails
   - AISMR video requirements
   - Best practices
   - Example: "AISMR videos must be 8.0 seconds"

3. **Procedural** - Process, workflow, how-to
   - Workflow definitions
   - Step-by-step processes
   - Execution patterns
   - Example: "Complete Video Production workflow"

### Memory Search

**Hybrid Approach:** Vector + Keyword

```typescript
// Vector search (semantic similarity)
SELECT * FROM memories
ORDER BY embedding <=> query_embedding
LIMIT 10;

// Keyword search (exact matches)
SELECT * FROM memories
WHERE textsearch @@ to_tsquery('english', query)
ORDER BY ts_rank(textsearch, query) DESC
LIMIT 10;

// Combine with Reciprocal Rank Fusion (RRF)
score = 1 / (k + rank)
// where k = 60 (standard RRF constant)
```

**Advanced Features:**

- **Temporal boosting** - Recent memories rank higher
- **Graph expansion** - Follow memory links (2 hops default)
- **Similarity threshold** - Filter by minimum cosine similarity
- **Multi-filter** - persona, project, memory type

### Memory Storage

**Automatic Enhancements:**

1. **Auto-summarization** - Content > 100 chars gets GPT-4o-mini summary
2. **Auto-linking** - Top 5 similar memories automatically linked
3. **Auto-embedding** - OpenAI text-embedding-3-small (1536d)
4. **Auto-indexing** - Full-text search index updated

**Storage Process:**

```typescript
1. Validate single-line content
2. Generate embedding (text-embedding-3-small)
3. Generate summary if needed (gpt-4o-mini)
4. Detect related memories (vector search)
5. Insert with all enhancements
6. Update full-text index
```

---

## Multi-Agent Workflow System

### Autonomous Agent Handoffs

**North Star Vision:** Each specialist agent is an autonomous black box that receives natural language instructions, loads its own context, searches memory for what it needs, does the work, and hands off to the next agent.

**Key Principles:**

1. **Casey coordinates, doesn't orchestrate** - She kicks off work and waits for completion
2. **Direct agent-to-agent handoffs** - No returning to Casey between steps
3. **Memory-based coordination** - Agents find context via memory_search filtered by traceId
4. **HITL via n8n Telegram nodes** - Agents can pause for human approval using "Send and Wait"

### The Agent Team

**Casey** - Showrunner (Coordinator)

- Receives user requests
- Creates execution trace (trace_create)
- Kicks off first agent (handoff_to_agent)
- Waits for completion signal
- Notifies user when done

**Iggy** - Creative Director (Idea Generation)

- Generates concepts (12 AISMR modifiers or 6 GenReact scenarios)
- Searches memory for uniqueness
- HITL: Telegram approval of concepts
- Hands off to Riley

**Riley** - Head Writer (Screenplay)

- Writes detailed screenplays
- Validates against project specs (8s runtime, etc.)
- Ensures timing, guardrails, feasibility
- Hands off to Veo

**Veo** - Production (n8n workflow)

- Generates videos from screenplays
- Batch processing for multiple videos
- Monitors progress, retries on failure
- Hands off to Alex

**Alex** - Editor (Post-Production)

- Stitches multiple videos together
- Adds captions, overlays, labels
- HITL: Telegram approval before upload
- Hands off to Quinn

**Quinn** - Social Media Manager (Publishing)

- Creates optimized captions and hashtags
- Uploads to TikTok/YouTube
- Reports back with post URL
- Signals completion (workflow_complete)

### Prompt + Tool Template

All persona prompts inherit the shared contract in `docs/MCP_PROMPT_NOTES.md`. Highlights:

1. **Trace discipline:** Never invent IDs; always propagate the `{traceId, projectId, sessionId}` that Casey created via `trace_create`.
2. **Memory-first workflow:** Load context with `memory_search` using the `traceId` parameter (newest-first results) before acting and store outputs via `memory_store` as single-line entries tagged with `traceId`, `persona`, and `project`.
3. **Coordinated handoffs:** Use `handoff_to_agent` with clear natural-language instructions plus the memory IDs or tags the next agent should read.
4. **Completion signal:** Quinn (or any terminal persona) must call `workflow_complete(traceId, status, outputs)` and notify Casey/user.
5. **HITL routing:** Telegram "Send and Wait" nodes handle approvals/clarifications; the legacy `clarify_ask` tool no longer exists.

The prompt notes file also contains example `tools/call` payloads for each MCP tool and persona-specific prompt snippets so n8n stays in sync with `plan.md`.

### n8n Workflow Template

Every persona workflow follows a predictable layout (see `workflows/casey.workflow.json` for the canonical example now that Story 2.1 is live):

1. **Trigger:** Telegram (Casey) or "When Executed by Another Workflow" nodes that accept `{traceId, project, sessionId, instructions}`.
2. **AI Agent Node:** `@n8n/n8n-nodes-langchain.agent` (gpt-5-nano unless overridden) using the persona-specific prompt plus an MCP client exposing `memory_search`, `memory_store`, `handoff_to_agent`, and `workflow_complete` (Quinn only).
3. **Tool Workflow Delegation:** Pair each `handoff_to_agent` call with a `Call n8n workflow` node (LangChain `toolWorkflow`) so downstream personas start immediately—Casey never re-enters the loop.
4. **HITL Nodes:** Telegram "Send and Wait" nodes gate Iggy and Alex; accept/decline branches feed directly back into the AI Agent with explicit feedback.
5. **Observability:** Every stored memory includes the `traceId`, making the entire execution graph discoverable via `memory_search` without bespoke run-state tables.

See `docs/MCP_PROMPT_NOTES.md` for the detailed checklist used when building new workflows.

### Execution Tracking

Every workflow run tracked via execution traces:

```sql
CREATE TABLE execution_traces (
  id UUID PRIMARY KEY,
  trace_id TEXT UNIQUE NOT NULL,
  project_id TEXT NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL, -- active, completed, failed
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  metadata JSONB
);
```

**Status Tracking:**

- All memories tagged with traceId
- Full execution graph reconstructable from memory
- Agents search memory by traceId to find prior outputs
- Casey receives completion signal via workflow_complete

---

## Session Management

**Session Lifecycle:**

1. **Create** - First interaction creates session

   ```typescript
   const session = await findOrCreate(
     sessionId: "telegram:6559268788",
     userId: "mylo",
     persona: "casey",
     project: "aismr"
   );
   ```

2. **Context** - Working memory stored in session

   ```typescript
   await updateContext(sessionId, {
     lastIntent: 'generate-ideas',
     lastWorkflowRun: 'run-abc-123',
     recentTopics: ['rain', 'cozy'],
     preferences: { style: 'gentle' },
   });
   ```

3. **History** - Conversation history tracked

   ```typescript
   await addToConversationHistory(
     sessionId,
     'user',
     'Create AISMR video about rain'
   );
   ```

4. **Persistence** - Survives restarts
   - Session state in Postgres
   - Accessible across interactions
   - Agent can resume conversations

---

## Error Handling

### Retry Logic

OpenAI API calls wrapped with exponential backoff:

```typescript
await withRetry(
  async () => await openai.embeddings.create(...),
  {
    maxRetries: 3,
    initialDelay: 1000,
    backoffMultiplier: 2,
    shouldRetry: (error) =>
      error.message.includes('rate_limit') ||
      error.message.includes('network')
  }
);
```

### Error Hierarchy

```
MCPError (base)
├── DatabaseError
├── OpenAIError
├── WorkflowError
└── ValidationError
```

**Error Response:**

```json
{
  "error": {
    "code": "WORKFLOW_ERROR",
    "message": "Workflow not found",
    "workflowId": "workflow-xyz"
  }
}
```

---

## Metrics & Observability

### Prometheus Metrics

- `mcp_tool_call_duration_ms` - Tool execution time
- `mcp_tool_call_errors_total` - Tool error count
- `memory_search_duration_ms` - Search performance
- `memory_search_results_count` - Result counts
- `workflow_executions_total` - Workflow runs
- `workflow_duration_ms` - Workflow execution time
- `db_query_duration_ms` - Database performance
- `active_sessions_count` - Concurrent sessions

### Performance Targets

- Memory search: < 100ms (p95)
- Workflow discovery: < 200ms (p95)
- Tool calls: < 200ms (p95)
- Database queries: < 50ms (p95)

---

## Deployment

### Docker Compose

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    ports: ['5432:5432']
    volumes:
      - postgres_data:/var/lib/postgresql/data

  mcp-server:
    build: .
    ports: ['3000:3000']
    depends_on:
      postgres:
        condition: service_healthy

  n8n:
    image: n8nio/n8n
    ports: ['5678:5678']
    depends_on:
      - postgres
      - mcp-server
    volumes:
      - n8n_data:/home/node/.n8n
```

### Start Command

```bash
docker compose up
```

That's it. Everything starts and works together.

---

## Design Principles

1. **Semantic Over Syntactic**
   - Find by meaning, not by name
   - Agent understands intent

2. **Memory Over State**
   - Everything is remembered
   - Nothing is hardcoded

3. **Simple Over Complex**
   - One agent, not many
   - Three services, not twenty

4. **Data Over Code**
   - Workflows are data
   - Add capability = add JSON

5. **Autonomous Over Reactive**
   - Agent decides when to retrieve
   - Agent chooses what to do

---

## Future Extensions

### Multi-Project Support

- Same architecture, different projects
- Semantic discovery across domains

### Learning & Adaptation

- Track workflow success rates
- Evolve workflows based on outcomes
- Learn user preferences over time

### Multi-Agent Collaboration (Current: Epic 1-2)

- Six specialized agents (Casey, Iggy, Riley, Veo, Alex, Quinn)
- Coordinated via trace IDs and memory tagging
- Each agent autonomous with dedicated n8n workflow
- Natural language instructions between agents
- HITL checkpoints via Telegram "Send and Wait"

---

**The architecture is designed to be extended, not replaced.**

Every new capability is a new tool, workflow, or memory type. The core remains unchanged.
