# MCP Prompts V2 - Comprehensive Code Review
**Date:** November 5, 2025  
**Reviewers:** Claude Sonnet 4.5 + GPT-5 Codex  
**Scope:** Complete v2/ directory with architecture, implementation, and integration analysis

---

## Executive Summary

**TL;DR:** V2 has **excellent architecture and documentation** (9/10) but **incomplete implementation** (~40%). The MCP server layer and database are production-ready, but critical workflow execution and n8n integration are stubs or missing.

**Readiness:** ⚠️ **Pre-Alpha** - Foundation is solid, but core features don't work yet.

**North Star Gap:** The promise of "text message → video in production" is **blocked** by missing workflow execution engine and n8n integration. Memory, discovery, and SQL scaffolding exist, but orchestration is absent.

**Key Architectural Insight:** Credentials are managed **in n8n**, not the MCP server. This is a major simplification—all external API credentials (Telegram, OpenAI, Kie.ai, Google, Shotstack) are already configured in n8n. The MCP server only needs database and OpenAI credentials for its own operations. No credential sync or management needed between systems.

**Recommendation:** **3-4 weeks of focused work** to complete workflow execution engine and n8n integration before adding new features. Foundation is strong—just needs the implementation to match the vision.

---

## 🟢 What's Working Well

### 1. Architecture & Design (9/10)

✅ **Excellent separation of concerns**
- Clean 3-service architecture (Postgres, MCP Server, n8n)
- MCP tools properly abstracted with repository pattern
- Type-safe database layer with Drizzle ORM
- Strong type system with discriminated unions

✅ **Outstanding documentation quality**
- `NORTH_STAR.md` - Comprehensive vision with code examples
- `ARCHITECTURE.md` - Clear system design
- `MCP_TOOLS.md` - Complete tool reference
- `WORKFLOW_DISCOVERY.md` - Detailed workflow patterns
- `CODING_STANDARDS.md` - Thorough development guidelines

### 2. Database Layer (8/10)

✅ **Production-ready schema**
- pgvector extension (1536d embeddings, HNSW index)
- Full-text search with GIN indices
- Proper temporal tracking (created_at, updated_at, last_accessed_at)
- Constraint: content_no_newlines (enforces single-line rule)

✅ **Repository pattern implemented correctly**
- `MemoryRepository` - Vector search, RRF, graph expansion
- `PersonaRepository`, `ProjectRepository`, `SessionRepository`
- `WorkflowRunRepository` - Execution tracking

### 3. MCP Server (7/10)

✅ **11 tools registered and validated**
```typescript
// Working tools ✅
- memory_search, memory_store, memory_evolve
- context_get_persona, context_get_project
- clarify_ask
- session_get_context, session_update_context

// Partially working ⚠️
- workflow_discover (discovery works, execution is stub)
- workflow_status (returns status but execution is stub)

// Not working ❌
- workflow_execute (only creates DB entry, doesn't execute)
```

✅ **Good tool patterns**
- Zod validation on all inputs
- Request ID tracking
- Structured error responses
- Logging with sanitization
- Health checks with detailed status

### 4. Testing Infrastructure (8/10)

✅ **Comprehensive test organization**
- Unit tests (tool tests, repository tests, utilities)
- Integration tests (cross-component)
- E2E tests (full flow)
- Performance tests (benchmarks)
- Testcontainers for ephemeral databases
- OpenAI mocking system with seed data

---

## 🔴 Critical Issues (Blocking)

### 1. **Workflow Execution is a Stub** (P0 - BLOCKING)

**Problem:** Core feature doesn't work. Workflow "execution" just creates a database entry and returns immediately.

```17:55:/Users/mjames/Code/mcp-prompts/v2/src/tools/workflow/executeTool.ts
export async function executeWorkflow(
  params: WorkflowExecuteParams
): Promise<WorkflowExecuteResult> {
  // ... existing code ...
  // 4. For Phase 3: Return immediately with pending status
  // The agent will execute steps itself using available MCP tools
  // In Phase 4, we'll add actual execution logic for n8n delegation
  return {
    workflowRunId: run.id,
    status: 'running',
    output: undefined,
    error: undefined,
  };
}
```

**Impact:** 
- **Blocks entire North Star vision** - Can't generate ideas, write screenplays, or produce videos
- Tests pass without catching it (false positives)
- The promised "idea → video → upload in 5 minutes" cannot happen

**What's Missing:**
- No workflow engine to execute stored step graph
- No variable resolution (`{{var}}` interpolation)
- No MCP tool calls from workflow steps
- No LLM calls from workflow steps
- No n8n delegation logic
- No error handling for failed steps
- No parallel execution support
- No workflow resumption after failures

**Fix Required:** Build complete workflow engine (see recommendations below).

---

### 2. **Workflow Definitions Reference Non-Existent Tools** (P0 - BLOCKING)

**Problem:** All migrated workflows still call legacy `conversation.remember` / `prompts.search` instead of new `memory_*` / `context_*` MCP tools.

```12:61:/Users/mjames/Code/mcp-prompts/v2/data/workflows/aismr-idea-generation-workflow.json
"mcp_call": {
  "tool": "conversation.remember",
  "params": {
    "sessionId": "${context.sessionId}",
    "query": "past AISMR ideas generated",
    "limit": 50,
    "format": "bullets"
  },
  "storeAs": "pastIdeas"
}
```

**Impact:** Even if `workflow_execute` were fixed, the agent would try to invoke tools that don't exist, producing runtime failures.

**Fix Required:** 
- Rewrite workflow metadata to reference shipped MCP tool names
- Supply translation logic for legacy fields (`searchMode`, `storeAs`)
- Update all workflow JSON files in `data/workflows/`

---

### 3. **Persona ID Mismatch** (P0 - BLOCKING)

**Problem:** Casey persona is stored under ID `chat`, but tooling expects `casey`.

```12:18:/Users/mjames/Code/mcp-prompts/v2/data/personas/casey.json
"agent": {
  "name": "Casey",
  "id": "chat",
  "title": "Conversational Orchestrator",
  // ...
}
```

```64:72:/Users/mjames/Code/mcp-prompts/v2/scripts/test-mcp-client.ts
const persona = await client.callTool({
  name: 'context_get_persona',
  arguments: {
    personaName: 'casey',
  },
});
```

**Impact:** 
- `context_get_persona` fails for the primary agent persona
- n8n and tests can't bootstrap identity
- Session creation fails with wrong persona ID

**Fix Required:** Either:
- Migrate persona record to `casey` ID, OR
- Update all callers (n8n workflow, docs, scripts, tests) to use `chat` consistently

---

### 4. **TypeScript Build Fails** (P0 - BLOCKING)

**Problem:** Mock OpenAI client doesn't match real OpenAI SDK types.

```typescript
// src/clients/openai.ts:18
error TS2352: Conversion of type '{ embeddings: ... }' to type 'OpenAIClient'
may be a mistake because neither type sufficiently overlaps with the other.
```

**Impact:** 
- Can't compile TypeScript
- Can't run in production
- No real vector embeddings work

**Fix Required:**
```typescript
// Option 1: Use proper type assertion
return {
  embeddings: { ... },
  chat: { ... }
} as unknown as OpenAIClient;

// Option 2: Make OpenAIClient more flexible
export type OpenAIClient = {
  embeddings: {
    create: (params: any) => Promise<any>;
  };
  chat: {
    completions: {
      create: (params: any) => Promise<any>;
    };
  };
};
```

---

### 5. **n8n Integration Missing** (P0 - BLOCKING)

**Problem:** docker-compose.yml includes n8n service, but no actual integration code exists.

**What's Missing:**
- n8n HTTP client to trigger workflows (via n8n REST API)
- Webhook handlers for n8n callbacks
- Workflow trigger endpoints
- Workflow import/export utilities via n8n API
- Real agent workflow needs to be imported into n8n instance

**What's Already Working:**
- ✅ n8n credentials are stored in n8n (kie.ai, google, mylo mcp already configured)
- ✅ Programmatic workflows ready (`edit-aismr.workflow.json`, `generate-video.workflow.json`)
- ✅ Agent workflow structure exists (`agent.workflow.json`)
- ✅ Workflow calling pattern defined (toolWorkflow nodes)

**n8n API Integration Needed:**

Based on n8n documentation, you need to implement:

```typescript
// src/integrations/n8n/client.ts
class N8nClient {
  constructor(
    private baseUrl: string,  // e.g., http://n8n:5678
    private apiKey?: string   // Optional: X-N8N-API-KEY header
  ) {}

  // Trigger workflow execution
  async executeWorkflow(workflowId: string, data: unknown): Promise<string> {
    // POST /api/v1/workflows/{workflowId}/execute
    // Returns execution ID
  }

  // Check execution status
  async getExecutionStatus(executionId: string): Promise<{
    status: 'running' | 'success' | 'error' | 'waiting';
    data?: unknown;
    error?: string;
  }> {
    // GET /api/v1/executions/{executionId}
  }

  // Import workflow JSON into n8n
  async importWorkflow(workflow: unknown): Promise<string> {
    // POST /api/v1/workflows
  }

  // Get workflow by ID
  async getWorkflow(workflowId: string): Promise<unknown> {
    // GET /api/v1/workflows/{workflowId}
  }
}
```

**Impact:** 
- Can't demonstrate end-to-end flow: Telegram → n8n → MCP → Response
- Programmatic workflows (edit-aismr, generate-video) can't be called from agent
- No way to delegate long-running tasks to n8n

**Credential Architecture Clarification:**

**n8n Side (already working):**
- ✅ Telegram API credentials (for Telegram trigger)
- ✅ OpenAI API credentials (for AI agent)
- ✅ MCP header auth (for calling MCP server)
- ✅ Kie.ai credentials (for video generation)
- ✅ Google API credentials (for Google Drive uploads)
- ✅ Shotstack credentials (for video editing)
- ✅ Bearer auth tokens for various APIs

**MCP Server Side (what you need):**
- OpenAI API key (for embeddings, LLM calls)
- Database connection string (PostgreSQL with pgvector)
- Optional: n8n API key (for calling n8n API if auth is enabled)
- Optional: MCP_AUTH_KEY (for securing /mcp endpoint)

**Note:** You have working programmatic workflows like `edit-aismr.workflow.json` and `generate-video.workflow.json` that are pure n8n workflows (no AI needed). These should be callable as tools via n8n's `toolWorkflow` nodes (like shown in `agent.workflow.json` line 192 `"Call 'Edit_AISMR'"`). Once workflows are imported into n8n and the agent workflow is activated, the AI can call these as functions.

---

### 6. **Session Bootstrap Hard-codes Invalid Persona/User** (P1 - HIGH)

**Problem:** `session_get_context` creates missing sessions with hardcoded `userId: "unknown"` and `persona: "casey"`.

```340:369:/Users/mjames/Code/mcp-prompts/v2/src/mcp/tools.ts
const session = await repository.findOrCreate(
  validated.sessionId,
  'unknown',
  'casey',
  'aismr'
);
```

**Impact:** 
- On first contact, wrong persona is persisted
- Real user ID is lost
- Breaks continuity/auditability
- Reintroduces persona mismatch from finding #3

**Fix Required:** Require caller to provide user+persona, or infer from session metadata (e.g., `telegram:123`).

---

### 7. **MCP Endpoint Ignores Required Auth** (P1 - HIGH)

**Problem:** Fastify handler never checks `MCP_AUTH_KEY`, yet documentation and n8n config assume header authentication.

```65:104:/Users/mjames/Code/mcp-prompts/v2/src/server.ts
fastify.post('/mcp', async (request, reply) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    // ... existing code ...
    await transport.handleRequest(request.raw, reply.raw, body);
  } catch (error) {
    // ... existing code ...
  }
});
```

**Impact:** 
- Anyone can hit `/mcp` without a key
- Security vulnerability in production
- n8n wastes cycles sending headers that are never validated

**Fix Required:** 
- Enforce header check: `request.headers['x-mcp-auth-key']`
- Return `401` on mismatch before invoking MCP transport

---

### 8. **Health Check Calls OpenAI Synchronously** (P1 - HIGH)

**Problem:** `/health` invokes `embedText('test')` on every request.

```28:48:/Users/mjames/Code/mcp-prompts/v2/src/server.ts
// Check OpenAI
try {
  await embedText('test');
  checks.openai = 'ok';
} catch (error) {
  checks.openai = 'error';
  allHealthy = false;
}
```

**Impact:** 
- Liveness probes spam OpenAI
- Adds latency to health checks
- Will fail when API rate-limits, even if service is healthy

**Fix Required:** Cache the result or replace with lightweight dependency probe (verify env vars during startup).

---

## 🟡 Moderate Issues

### 9. **Missing ESLint Config** (P1)

**Problem:** `package.json` references `npm run lint` but no config exists.

```bash
> npm run lint
ESLint couldn't find an eslint.config.(js|mjs|cjs) file.
```

**Impact:** Can't enforce code quality standards.

**Fix Required:** Create `eslint.config.mjs` with TypeScript rules.

---

### 10. **Security Vulnerabilities** (P1)

**Problem:** `npm audit` shows 4 moderate severity vulnerabilities.

**Fix Required:** Run `npm audit fix` and verify tests still pass.

---

### 11. **Missing .env.example** (P2)

**Problem:** README instructs `cp .env.example .env`, but file doesn't exist.

```48:65:/Users/mjames/Code/mcp-prompts/v2/README.md
# Create .env file
cp .env.example .env
# Edit .env with your secrets (OpenAI API key is required for non-test runs)
```

**Impact:** New contributors can't boot the stack without guessing env vars.

**Fix Required:** Add template file or update docs to reference setup script.

---

### 12. **Context7 / Docs Lookup Tool Missing** (P2)

**Problem:** Design docs mark `docs.lookup` via Context7 as "CRITICAL," but no such tool is registered.

**Impact:** 
- North-star behaviour ("always consult docs") is impossible
- Developers may assume it exists

**Fix Required:** Either implement `docs_lookup` MCP tool backed by Context7 or rewrite docs to reflect current capabilities.

---

### 13. **Workflow Relevance Scoring Ignores Similarity** (P2)

**Problem:** Discovery assigns scores purely by array index, not by actual semantic similarity.

```30:51:/Users/mjames/Code/mcp-prompts/v2/src/tools/workflow/discoverTool.ts
return {
  workflowId: memory.id,
  name: workflowDef.name || 'Unknown Workflow',
  description: workflowDef.description || memory.summary || memory.content,
  relevanceScore: 1.0 - index * 0.05, // Simple relevance scoring
  workflow: workflowDef,
  memoryId: memory.id,
};
```

**Impact:** Agents can pick the wrong workflow when multiple matches exist.

**Fix Required:** Bubble actual RRF/embedding score from `searchMemories` and normalize instead of `1 - index*0.05`.

---

### 14. **Metrics Instrumentation Incomplete** (P2)

**Problem:** Metrics exist (`db_query_duration_ms` counters/histograms) but never observe them.

**Impact:** `/metrics` endpoint overstates observability; can't monitor performance.

**Fix Required:** Wrap repository calls with timing helpers or remove unused metrics.

---

### 15. **Memory Graph Expansion Not Fully Tested** (P2)

**Problem:** `src/utils/graphExpansion.ts` exists with unit tests, but integration with `memory_search` needs more testing.

**Impact:** Related memories may not surface correctly in real workflows.

**Fix Required:** Add integration tests with real graph scenarios.

---

### 16. **Temporal Boosting Not Fully Implemented** (P2)

**Problem:** `src/utils/temporal.ts` exists but not integrated into RRF scoring in `memory_search`.

**Impact:** Recent memories aren't weighted higher in search results; agent may surface stale memories.

**Fix Required:** Apply temporal decay in RRF scoring function.

---

## 📊 North Star Alignment

### Vision from NORTH_STAR.md:
> "A video in production, from a simple text message."

### Current Reality:

```
User: "Create an AISMR video about rain sounds"
  │
  ▼
[Telegram] ──❌──> [n8n Agent] ──❌──> [MCP Tools] ──✅──> [Database]
                       ↓                    ↓
                   (STUB)              (WORKING)
                       ↓
                   ❌ No workflow execution
                   ❌ No idea generation
                   ❌ No screenplay writing
                   ❌ No video generation
                   ❌ No TikTok upload
```

**What Works:**
- ✅ MCP server can search/store memories
- ✅ Can load persona/project context
- ✅ Can discover workflows semantically
- ✅ Database schema is ready

**What's Missing (Critical Path):**
1. ❌ n8n → MCP connection (can't call tools from n8n)
2. ❌ Workflow execution engine (can't run multi-step workflows)
3. ❌ Idea generation workflow (no AI generation logic)
4. ❌ Screenplay workflow (no screenplay generation)
5. ❌ Video generation (no integration with video APIs)
6. ❌ TikTok upload (no TikTok API integration)

**North Star Completion: ~25%**

---

## 🎯 Programmatic Workflows (Non-AI) & Credential Architecture

### Credential Management: Simplified

**Key Insight:** Credentials are managed **in n8n**, not in the MCP server. This is a major architectural simplification.

**What This Means:**
- ✅ All external API credentials (Telegram, OpenAI, Kie.ai, Google, Shotstack) are stored in n8n's credential system
- ✅ n8n workflows reference credentials by ID (e.g., `"telegramApi": { "id": "eC8lO0ynjt4o2RIL" }`)
- ✅ MCP server only needs its own server-side credentials (database, OpenAI for embeddings)
- ✅ No credential sync or management needed between systems
- ✅ n8n's credential encryption and security features handle everything

**MCP Server Only Needs:**
1. `DATABASE_URL` - PostgreSQL connection string with pgvector
2. `OPENAI_API_KEY` - For embeddings and LLM calls within MCP tools
3. `MCP_AUTH_KEY` (optional) - To secure the `/mcp` endpoint from unauthorized access
4. `N8N_API_KEY` (optional) - If you enable n8n API authentication

**n8n Already Has (verified in workflows):**
- Telegram API credentials (credential ID: `eC8lO0ynjt4o2RIL`)
- OpenAI API credentials (credential ID: `ddYuAnkE3FT5NJj3`)
- MCP header auth (credential ID: `PDRTlQZsKzQBcv6T`) - for n8n calling MCP server
- Kie.ai Bearer Auth (credential ID: `AmyJW31FD33zltAm`) - for video generation
- Google Drive credentials - for uploads
- Shotstack credentials (credential ID: `S31bXA351k9zXbHo`) - for video editing
- Various other API credentials as needed

**Architecture Benefits:**
- 🚀 Simpler deployment - credentials stay in n8n
- 🔒 Better security - n8n's encryption handles sensitive data
- 🔧 Easier updates - change credentials in n8n UI, no code changes
- 📦 Cleaner separation - MCP focuses on memory/context, n8n handles external integrations

---

### Working Programmatic Workflows

You have two working programmatic workflows that don't require AI—they just execute API calls and data transformations:

### 1. `edit-aismr.workflow.json` (Edit_AISMR)
- **Purpose:** Takes 12 generated videos, builds Shotstack edit JSON with crossfade transitions, renders final AISMR video
- **Trigger:** Execute Workflow Trigger (takes `runId`)
- **Steps:**
  1. Get workflow run from API
  2. Get videos from API (`/api/videos?run=<runId>`)
  3. Build Shotstack edit JSON (12 clips, 6.5s stride, 1s crossfades, text overlays)
  4. POST to Shotstack API
  5. Poll for render completion (7s wait loop)
  6. Update workflow run status
- **Status:** ✅ Complete and ready to use
- **Can be called as tool:** Yes, via n8n's `toolWorkflow` node (already in `agent.workflow.json` line 192)

### 2. `generate-video.workflow.json` (Generate Video)
- **Purpose:** Takes a single idea, generates video using Veo 3 Fast API
- **Trigger:** Execute Workflow Trigger (takes `id`, `runId`)
- **Steps:**
  1. Get workflow run from API
  2. Get idea/prompt from API (`/api/videos/<id>`)
  3. POST to Veo API (text-to-video)
  4. Poll for video completion (10s wait loop)
  5. Update video record with URL
  6. Update workflow run status
- **Status:** ✅ Complete and ready to use
- **Can be called as tool:** Yes, via n8n's `toolWorkflow` node

### How These Work as Tools (n8n toolWorkflow Pattern)

In `agent.workflow.json`, line 152-193 shows the pattern:

```json
{
  "parameters": {
    "workflowId": {
      "__rl": true,
      "value": "z34mb3qsWQfoiWVD",
      "mode": "list",
      "cachedResultName": "Edit_AISMR"
    },
    "workflowInputs": {
      "mappingMode": "defineBelow",
      "value": {
        "runId": "={{ $fromAI('runId', ``, 'string') }}"
      }
    }
  },
  "type": "@n8n/n8n-nodes-langchain.toolWorkflow",
  "name": "Call 'Edit_AISMR'"
}
```

**How n8n's toolWorkflow Node Works:**

This is a **native n8n LangChain integration** that exposes n8n workflows as AI tools:

1. **Tool Registration:** The AI agent (via LangChain) sees `"Call 'Edit_AISMR'"` as an available tool
2. **AI Decision:** When the AI decides it needs to edit a video, it calls this tool
3. **Parameter Extraction:** `$fromAI('runId', '', 'string')` extracts parameters from AI's tool call
4. **Workflow Execution:** n8n triggers the `Edit_AISMR` workflow with the provided parameters
5. **Synchronous Return:** The workflow runs to completion and returns result to the AI
6. **AI Continues:** The AI receives the result and continues its conversation

**Why This Is Powerful:**

- ✅ **No code needed** - Workflows become functions the AI can call
- ✅ **Type-safe** - n8n validates workflow inputs
- ✅ **Composable** - AI can chain multiple workflow calls
- ✅ **Isolated execution** - Each workflow runs in its own context
- ✅ **Built-in error handling** - n8n's retry/error logic applies

**Example Flow:**

```
User: "Create an AISMR video about rain"
  ↓
AI Agent: [calls workflow_discover to find idea generation workflow]
  ↓
AI Agent: [calls workflow_execute to generate 12 ideas]
  ↓
AI Agent: [calls clarify_ask to let user select idea]
  ↓
AI Agent: [calls toolWorkflow "Generate Video" with selected idea]
  ↓
n8n: Executes generate-video.workflow.json (calls Veo API, polls for completion)
  ↓
AI Agent: [receives video URL, calls toolWorkflow "Edit_AISMR" with runId]
  ↓
n8n: Executes edit-aismr.workflow.json (builds Shotstack edit, renders final video)
  ↓
AI Agent: "Your video is ready! [URL]"
```

**What Needs to Happen:**

1. ✅ Workflows are ready (edit-aismr.workflow.json, generate-video.workflow.json)
2. ✅ Agent workflow structure exists (agent.workflow.json)
3. ✅ Credentials are configured in n8n
4. ❌ Import workflows into n8n and get their IDs
5. ❌ Update agent workflow with correct workflow IDs
6. ❌ Activate agent workflow in n8n
7. ❌ Test end-to-end flow

---

## 🔧 What Would I Change If Rewriting?

### 1. **Workflow Engine as First-Class Service** (High Priority)

**Current:** Workflow execution is an afterthought (stub in executeTool.ts).

**Proposed:**
```
src/
├── workflow-engine/
│   ├── executor.ts          # Step-by-step execution
│   ├── variableResolver.ts  # {{var}} resolution
│   ├── stepTypes/
│   │   ├── toolStep.ts      # MCP tool calls
│   │   ├── llmStep.ts       # OpenAI calls
│   │   ├── clarifyStep.ts   # User interaction
│   │   └── parallelStep.ts  # Concurrent execution
│   ├── n8nDelegate.ts       # Delegate to n8n for heavy tasks
│   └── resumption.ts        # Resume failed workflows
```

**Why:** Workflows are **core** to V2. They deserve proper implementation, not a stub.

---

### 2. **Separate n8n Integration Layer** (High Priority)

**Current:** n8n references scattered, no clear integration.

**Proposed:**
```typescript
// src/integrations/n8n/client.ts
class N8nClient {
  constructor(
    private baseUrl: string,
    private apiKey?: string
  ) {}

  async executeWorkflow(
    workflowId: string, 
    data: unknown
  ): Promise<string> {
    // POST /api/v1/workflows/{workflowId}/execute
    // Returns executionId
  }

  async getExecutionStatus(executionId: string): Promise<{
    status: 'running' | 'success' | 'error' | 'waiting';
    data?: unknown;
    error?: string;
  }> {
    // GET /api/v1/executions/{executionId}
  }

  async waitForCompletion(
    executionId: string,
    timeout: number,
    pollInterval: number = 2000
  ): Promise<unknown> {
    // Poll GET /api/v1/executions/{executionId} until complete
  }

  async importWorkflow(workflow: unknown): Promise<string> {
    // POST /api/v1/workflows
  }

  async listExecutions(filter?: {
    status?: string;
    limit?: number;
  }): Promise<Array<unknown>> {
    // GET /api/v1/executions
  }
}
```

**API Endpoints from n8n Documentation:**
- `POST /api/v1/workflows/{workflowId}/execute` - Trigger workflow
- `GET /api/v1/executions/{executionId}` - Get execution status
- `GET /api/v1/executions` - List executions (filter by status, limit)
- `POST /api/v1/workflows` - Import workflow
- `GET /api/v1/workflows/{workflowId}` - Get workflow details

**Authentication:**
- Header: `X-N8N-API-KEY: your-api-key-here`
- Optional in development/self-hosted setups

**Why:** n8n is external system - needs clear API boundary with proper REST client.

---

### 3. **Event-Driven Architecture for Async Operations** (Medium Priority)

**Current:** Workflow execution is synchronous (stub).

**Proposed:**
```typescript
// When agent calls workflow_execute
1. Create workflow_run (status: pending)
2. Emit event: WorkflowStarted
3. Return workflowRunId immediately
4. Background worker picks up event
5. Executes workflow steps
6. Emits events: StepCompleted, WorkflowCompleted, WorkflowFailed
7. Agent polls workflow_status or receives webhook
```

**Tech:** Redis pub/sub, BullMQ, or native Postgres LISTEN/NOTIFY.

**Why:** Video generation takes 3 minutes. Can't block HTTP requests.

---

### 4. **Observability from Day 1** (Medium Priority)

**Current:** Metrics exist but not used.

**Proposed:**
```typescript
// Every tool call
metricsHistogram.observe({ tool: 'memory_search' }, duration);
metricsCounter.inc({ tool: 'memory_search', status: 'success' });

// Every workflow step
metricsHistogram.observe({ step: 'generate_ideas' }, duration);

// Every OpenAI call
metricsCounter.inc({ model: 'gpt-4o-mini', type: 'embedding' });
costGauge.set(totalCostToday);
```

**Why:** Can't optimize what you can't measure.

---

### 5. **Progressive Enhancement, Not Big Bang** (Philosophy)

**Current:** Documentation describes complete system, but implementation is 40% done.

**Proposed:**
```
Phase 1: Build MCP server + memory (DONE ✅)
Phase 2: Build simple workflow executor (IN PROGRESS)
Phase 3: Integrate n8n (NEXT)
Phase 4: Add video generation (FUTURE)
Phase 5: Add TikTok upload (FUTURE)
```

**Why:** Deliver incremental value. Test each layer before adding next.

---

## 📝 Specific Action Items

### Immediate (Next 2 Weeks):

**Week 1: Fix & Stabilize**
- [ ] Fix TypeScript errors in `openai.ts`
- [ ] Add `eslint.config.mjs`
- [ ] Run `npm audit fix`, verify no breaking changes
- [ ] Add `.env.example` template
- [ ] Enforce MCP auth in `/mcp` endpoint
- [ ] Replace OpenAI health check with env var validation
- [ ] Fix persona ID mismatch (choose `casey` or `chat`)
- [ ] Fix session bootstrap to require user+persona

**Week 2: Workflow Execution**
- [ ] Build `src/workflow-engine/executor.ts`
- [ ] Implement variable resolver (`{{var}}` interpolation)
- [ ] Add support for tool steps (call MCP tools)
- [ ] Add support for LLM steps (call OpenAI)
- [ ] Add error handling and resumption
- [ ] Write integration tests for executor

### Short-Term (Next Month):

**Week 3: n8n Integration**
- [ ] Build `src/integrations/n8n/client.ts` with n8n REST API calls
  - Implement `executeWorkflow()` - POST /api/v1/workflows/{id}/execute
  - Implement `getExecutionStatus()` - GET /api/v1/executions/{id}
  - Implement `waitForCompletion()` with polling
  - Implement `importWorkflow()` - POST /api/v1/workflows
- [ ] Import workflows into n8n via API or UI:
  - Import `agent.workflow.json` → Get workflow ID
  - Import `edit-aismr.workflow.json` → Get workflow ID
  - Import `generate-video.workflow.json` → Get workflow ID
- [ ] Update agent workflow with correct workflow IDs for toolWorkflow nodes
- [ ] Verify n8n credentials are working (already configured):
  - ✅ Telegram API (for message trigger)
  - ✅ OpenAI API (for AI agent)
  - ✅ MCP header auth (for calling MCP server)
  - ✅ Kie.ai (for video generation)
  - ✅ Google API (for uploads)
  - ✅ Shotstack (for video editing)
- [ ] Activate agent workflow in n8n
- [ ] Test Telegram → n8n → MCP → Response flow
- [ ] Test agent calling Edit_AISMR via toolWorkflow node
- [ ] Test agent calling Generate Video via toolWorkflow node

**Week 4: First Real Workflow**
- [ ] Implement idea generation workflow (AI-driven)
- [ ] Store 12 ideas in memory with uniqueness check
- [ ] Implement user selection via clarify tool
- [ ] Store selected idea with links
- [ ] Trigger Generate Video workflow (programmatic)
- [ ] End-to-end test with real Telegram bot

### Medium-Term (Next Quarter):

**Complete AISMR Pipeline**
- [ ] Screenplay generation workflow
- [ ] Video generation integration (already have generate-video.workflow.json)
- [ ] Video editing integration (already have edit-aismr.workflow.json)
- [ ] TikTok upload (integrate API)
- [ ] Complete video production pipeline end-to-end

**Add Missing Features**
- [ ] Implement Context7 docs lookup tool
- [ ] Add metrics instrumentation to all tools
- [ ] Set up Grafana dashboards
- [ ] Fix workflow relevance scoring (use real similarity)
- [ ] Integrate temporal boosting into RRF
- [ ] Test memory graph expansion with real scenarios

**Production Hardening**
- [ ] Add retries everywhere with exponential backoff
- [ ] Add circuit breakers for external APIs
- [ ] Add graceful degradation
- [ ] Add backup/restore procedures
- [ ] Multi-tenant support (user auth, rate limiting)

---

## 📈 Maturity Assessment

| Component             | Maturity       | Coverage | Production-Ready?        |
| --------------------- | -------------- | -------- | ------------------------ |
| Database Schema       | 🟢 Mature      | 100%     | ✅ Yes                   |
| MCP Server            | 🟡 Beta        | 70%      | ⚠️ Partial               |
| Memory Tools          | 🟢 Mature      | 90%      | ✅ Yes                   |
| Context Tools         | 🟢 Mature      | 100%     | ✅ Yes                   |
| Workflow Discovery    | 🟡 Beta        | 80%      | ⚠️ Partial               |
| Workflow Execution    | 🔴 Alpha       | 10%      | ❌ No (stub)             |
| n8n Integration       | 🔴 Not Started | 0%       | ❌ No                    |
| OpenAI Integration    | 🟡 Beta        | 60%      | ⚠️ Partial (type errors) |
| Testing               | 🟡 Beta        | Unknown  | ⚠️ Can't measure         |
| Documentation         | 🟢 Mature      | 95%      | ✅ Yes                   |
| Observability         | 🔴 Alpha       | 20%      | ❌ No                    |
| Programmatic Workflows| 🟢 Ready       | 100%     | ✅ Yes (edit-aismr, generate-video) |

**Overall Maturity: 🟡 Early Beta (40% complete)**

---

## 🎯 Final Verdict

### The Good:
- 🌟 **Outstanding documentation** - Clear vision, great examples
- 🌟 **Solid architecture** - Clean separation, good patterns
- 🌟 **Strong database layer** - Schema is production-ready
- 🌟 **Excellent type safety** - Well-organized types
- 🌟 **Good test structure** - Comprehensive test organization
- 🌟 **Working programmatic workflows** - Edit and video generation ready

### The Bad:
- ⚠️ **Incomplete implementation** - Core features are stubs
- ⚠️ **Type errors block builds** - Can't compile
- ⚠️ **No n8n integration** - Missing critical piece
- ⚠️ **No workflow execution** - Heart of the system not built
- ⚠️ **Can't measure coverage** - Build failures prevent testing

### The Ugly:
- 🚨 **Can't demonstrate North Star** - End-to-end flow doesn't work
- 🚨 **Documentation overpromises** - Describes features that don't exist
- 🚨 **Technical debt building up** - Type errors, missing configs, security vulns

### Should We Ship This?

**No.** Not in current state.

**Why:**
- Core workflow execution doesn't work
- n8n integration missing
- Can't demonstrate value to users
- Type errors prevent production build

### What's the Path Forward?

**Focus, focus, focus.**

1. **Fix build errors** (1 day)
2. **Build workflow executor** (1 week)
3. **Integrate n8n** (1 week)
4. **Build one complete workflow** (1 week)
5. **Demo end-to-end** (1 day)

**Timeline to MVP: 3-4 weeks of focused work.**

After that, V2 can demonstrate the North Star and deliver real value.

---

## ❓ Open Questions

### Architecture & Design

1. **Workflow Execution Strategy:**
   - Which subset of workflow steps should execute inside MCP vs. be delegated to n8n?
   - How do we surface long-running progress back to the agent?
   - Should we use event-driven architecture (Redis/BullMQ) or simpler polling?

2. **Session Management:**
   - How should we derive persona and project for new sessions?
   - Do we expect n8n to supply them, or should MCP server resolve from session metadata?
   - Should session IDs follow a specific format (e.g., `telegram:123`)?

3. **Programmatic Workflow Integration:**
   - Should programmatic workflows (edit-aismr, generate-video) be exposed as MCP tools, or only callable via n8n's toolWorkflow? *(Recommendation: Use toolWorkflow - cleaner separation, leverages n8n's execution engine)*
   - Do we need a registry of "available n8n workflows" that the agent can discover?
   - How do we handle workflow versioning (what if edit-aismr changes)?
   - Should we use n8n's Execute Workflow Trigger (current approach) or n8n API calls from MCP server?

### Implementation Details

4. **Persona ID Consistency:**
   - Should we standardize on `casey` or `chat` as the ID?
   - If we have both `id` and `name`, what's the difference in usage?
   - Do we need a migration script to fix existing data?

5. **MCP & n8n Authentication:**
   - MCP Server: Should we use header auth (`X-MCP-Auth-Key`), bearer tokens, or API keys?
   - n8n API: Should we enable API key auth or rely on network isolation?
   - Do we need per-client auth (different keys for n8n vs. other clients)?
   - Should auth be optional in development/test environments?
   - Current setup: n8n already has HTTP header auth configured for MCP calls

6. **Variable Resolution in Workflows:**
   - What's the complete set of variables available in workflow steps?
   - Can workflows define custom variables?
   - How do we handle missing variables (error vs. default)?

### Integration & Deployment

7. **n8n Workflow Management:**
   - How do we sync workflow definitions between JSON files and n8n? *(Options: Manual import via UI, API import on startup, version control via n8n API)*
   - Should workflows be imported manually or via API on startup? *(Recommendation: API import on first startup, then manual management)*
   - Do we version-lock n8n workflows to prevent drift?
   - n8n has workflow versioning built-in (`versionId`, `versionCounter` in workflow JSON) - should we track this in MCP server?

8. **Error Handling:**
   - How do we handle partial workflow failures (e.g., 10/12 videos succeeded)?
   - Should workflows auto-retry failed steps?
   - How do we surface errors to the user via Telegram?

9. **Testing Strategy:**
   - Can we run integration tests against a local n8n instance?
   - Do we need contract tests for n8n API?
   - How do we mock long-running workflows in tests?

### Context7 & Documentation

10. **Context7 Integration:**
    - Is Context7 integration still a priority, or can we defer it?
    - If we implement it, should it be:
      - A standalone MCP tool (`docs_lookup`)?
      - Integrated into existing tools (auto-lookup on errors)?
      - A separate service?
    - Which documentation sources should Context7 index (OpenAI, n8n, MCP, internal docs)?

### Performance & Observability

11. **Metrics & Monitoring:**
    - What metrics are most critical to track initially?
    - Should we use Prometheus + Grafana, or simpler logging?
    - Do we need distributed tracing (OpenTelemetry)?

12. **Rate Limiting:**
    - Should we rate-limit per session, per user, or globally?
    - What limits are appropriate for OpenAI API calls?
    - How do we handle rate limit errors gracefully?

---

## 🌟 Closing Thoughts

**V2 is a diamond in the rough.**

The vision is **crystal clear**. The architecture is **well-designed**. The documentation is **exemplary**. The programmatic workflows are **ready to use**.

But the implementation is **incomplete**.

With **3-4 weeks of focused work**, V2 can become a **powerful agentic system** that delivers on the North Star promise.

The foundation is strong. Now it's time to build the house.

---

**Reviewed by:** Claude Sonnet 4.5 + GPT-5 Codex  
**Date:** November 5, 2025  
**Next Review:** After Week 4 (December 3, 2025)

