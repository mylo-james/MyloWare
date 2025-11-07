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
│  ├── memory_search                             │
│  ├── memory_store                              │
│  ├── memory_evolve                             │
│  ├── context_get_persona                       │
│  ├── context_get_project                       │
│  ├── trace_create                              │
│  ├── handoff_to_agent                          │
│  ├── workflow_complete                         │
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
│  ├── projects (workflow collections)           │
│  ├── sessions (conversation state)             │
│  ├── execution_traces (trace coordination)    │
│  └── agent_webhooks (agent webhook configs)    │
│                                                 │
│  Indices:                                      │
│  ├── HNSW (vector similarity)                  │
│  ├── GIN (array containment)                   │
│  └── Full-text (keyword search)                │
└─────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Message Arrives

```
User: "Create an AISMR video about rain sounds"
  │
  ▼
Telegram Webhook
  │
  ▼
n8n Agent Workflow receives message
```

### 2. Agent Processes

```
Agent Node (GPT-4o-mini)
  │
  ├─► Load Persona via context_get_persona
  │   └─► "I am Casey, helping with AISMR"
  │
  ├─► Load Project via context_get_project
  │   └─► "AISMR specs: 8.0s runtime, etc"
  │
  ├─► Search Memory via memory_search
  │   └─► "Past rain ideas, user preferences"
  │
  ├─► Discover Workflow via workflow_discover
  │   └─► "Complete Video Production workflow"
  │
  └─► Decide: Execute workflow
```

### 3. Workflow Executes

```
workflow_execute({
  workflowId: "complete-video-production",
  input: { topic: "rain sounds" }
})
  │
  ├─► Step 1: Generate Ideas (MCP tool)
  │   └─► 12 unique ideas returned
  │
  ├─► Step 2: User Selection (clarify_ask)
  │   └─► User picks #1
  │
  ├─► Step 3: Write Screenplay (MCP tool)
  │   └─► Validated 8.0s screenplay
  │
  ├─► Step 4: Generate Video (delegated to n8n)
  │   └─► Video file created
  │
  └─► Step 5: Upload to TikTok (delegated to n8n)
      └─► Video published
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

Epic 1 introduces a trace-based coordination model for multi-agent workflows. This replaces the legacy run_state and handoff tools with a simpler, memory-first approach.

### Data Flow: Trace Create → Handoff → Complete

```
Casey receives user request
  │
  ▼
trace_create({ projectId: "aismr", sessionId: "..." })
  │
  ├─► Creates execution_traces row
  ├─► Generates unique traceId (UUID)
  └─► Returns traceId
  │
  ▼
handoff_to_agent({ traceId, toAgent: "iggy", instructions: "..." })
  │
  ├─► Validates trace exists and is active
  ├─► Looks up agent webhook from agent_webhooks table
  ├─► Constructs webhook URL: config.n8n.webhookUrl + webhookPath
  ├─► Invokes n8n webhook with payload:
  │   { traceId, instructions, metadata, projectId, sessionId }
  ├─► Captures executionId from n8n response
  ├─► Stores handoff event to memory (tagged with traceId)
  └─► Returns webhookUrl, executionId, status, toAgent
  │
  ▼
Iggy workflow executes autonomously
  │
  ├─► Searches memory by traceId to find context
  ├─► Generates outputs
  ├─► Stores outputs to memory (tagged with traceId)
  └─► Hands off to next agent (riley) via handoff_to_agent
  │
  ▼
... (chain continues through all agents)
  │
  ▼
workflow_complete({ traceId, status: "completed", outputs: {...} })
  │
  ├─► Updates execution_traces status to "completed"
  ├─► Sets completedAt timestamp
  ├─► Stores outputs reference
  ├─► Creates completion memory entry (tagged with traceId)
  └─► Returns traceId, status, completedAt, outputs
```

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

### MCP Tools

**`trace_create`:**
- Creates a new execution trace
- Parameters: `projectId` (required), `sessionId` (optional), `metadata` (optional)
- Returns: `traceId`, `status`, `createdAt`

**`handoff_to_agent`:**
- Hands off work to another agent via n8n webhook
- Parameters: `traceId` (required), `toAgent` (required), `instructions` (required), `metadata` (optional)
- Validates trace is active and agent webhook exists
- Invokes n8n webhook and stores handoff event to memory
- Returns: `webhookUrl`, `executionId`, `status`, `toAgent`

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
2. Determine if clarification needed
3. Load context (persona, project)
4. Search memory if relevant
5. Discover workflow if task-based
6. Execute workflow (delegates to n8n API) or respond directly
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

## Workflow System

### Semantic Discovery

Workflows are **data, not code**. They're stored as procedural memories:

```json
{
  "id": "workflow-abc-123",
  "content": "Complete AISMR video production from idea to upload",
  "memoryType": "procedural",
  "project": ["aismr"],
  "tags": ["workflow", "video-production"],
  "metadata": {
    "workflow": {
      "name": "Complete Video Production",
      "description": "Generate ideas → Select → Write → Generate → Upload",
      "steps": [
        { "id": "generate_ideas", "tool": "workflow.execute", ... },
        { "id": "user_selection", "type": "clarify.ask", ... },
        { "id": "write_screenplay", "tool": "workflow.execute", ... },
        { "id": "generate_video", "tool": "workflow.execute", ... },
        { "id": "upload_tiktok", "tool": "workflow.execute", ... }
      ]
    }
  }
}
```

**Discovery Process:**
```typescript
// Agent doesn't know workflow name
const intent = "create complete AISMR video";

// Semantic search finds best match
const workflows = await discoverWorkflow({
  intent,
  project: "aismr"
});

// Returns workflows ranked by relevance
// Agent picks top match and executes
```

### Execution Tracking

Every workflow run tracked in SQL:

```sql
CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES sessions(id),
  workflow_name TEXT NOT NULL,
  status TEXT NOT NULL, -- pending, running, completed, failed
  input JSONB,
  output JSONB,
  error TEXT,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  metadata JSONB
);
```

**Status Tracking:**
- Agent can query run status
- Resume failed workflows
- Track execution history
- Link runs to sessions

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
     lastIntent: "generate-ideas",
     lastWorkflowRun: "run-abc-123",
     recentTopics: ["rain", "cozy"],
     preferences: { style: "gentle" }
   });
   ```

3. **History** - Conversation history tracked
   ```typescript
   await addToConversationHistory(
     sessionId,
     "user",
     "Create AISMR video about rain"
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
    ports: ["5432:5432"]
    volumes:
      - postgres_data:/var/lib/postgresql/data
    
  mcp-server:
    build: .
    ports: ["3000:3000"]
    depends_on:
      postgres:
        condition: service_healthy
    
  n8n:
    image: n8nio/n8n
    ports: ["5678:5678"]
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

### Multi-Agent Collaboration
- Specialized agents (idea, screenplay, upload)
- Coordinated via shared memory
- Each optimized for specific task

---

**The architecture is designed to be extended, not replaced.**

Every new capability is a new tool, workflow, or memory type. The core remains unchanged.
