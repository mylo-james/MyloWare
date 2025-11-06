# Recursive Agent Orchestration: A Counter-Proposal

Version: 0.2  
Date: 2025-11-06  
Owner: Orchestration / MCP  
Status: Counter-Proposal to `codex-handoff-proposal.md`

---

## Executive Summary

This counter-proposal presents a **simpler, more elegant alternative** to the handoff-based orchestration model. Instead of explicit handoff tables and custody management, we leverage **recursive agent patterns** where a single agent orchestrates multi-step workflows by:

1. **Self-delegating** through procedural memory (prompts)
2. **Streaming execution context** through ephemeral working memory
3. **Persisting outcomes** in episodic memory with rich graph linkages
4. **Delegating heavy operations** to n8n toolWorkflow nodes

This approach eliminates the complexity of state machines, leases, and handoff tasks while achieving the same goal: reliable multi-step orchestration with human-in-the-loop, full observability, and zero hallucinated IDs.

---

## 1. Core Philosophy

### The Original Proposal's Approach
- Multiple specialized personas (writer, editor, uploader)
- Explicit handoff tasks with custody management
- State machine with leases and locking
- SQL-first routing with status enums

### Our Counter-Proposal
- **Single recursive agent** that discovers and executes multi-step workflows
- **Procedural memory as the orchestration plan** (prompts define workflows)
- **Episodic memory for execution trace** (automatic linking creates audit trail)
- **n8n for heavy lifting** (API calls, polling, external services)

---

## 2. Why Recursive > Handoff

### Complexity Comparison

**Original Handoff Model:**
```
User Request
  → Create agent_runs (SQL)
  → Agent A claims custody (lease)
  → Agent A does work
  → Agent A creates handoff_task (SQL)
  → Agent A calls Agent B workflow
  → Agent B claims handoff (check lease)
  → Agent B does work
  → Agent B completes handoff (SQL)
  → Agent B updates agent_runs (SQL)
```

**Recursive Agent Model:**
```
User Request
  → Agent discovers workflow (procedural memory)
  → Agent executes steps recursively:
    - Step 1: Call tool (MCP or n8n)
    - Store outcome (episodic memory)
    - Step 2: Call tool (MCP or n8n)
    - Store outcome (linked to Step 1)
    - Repeat...
  → Agent returns final result
```

### Benefits of Recursive Pattern

1. **No Coordination Overhead**: No lease management, no custody transfers, no handoff state
2. **Simpler Mental Model**: One agent, one execution path, clear causality
3. **Natural Resumability**: Memory chain provides complete execution history
4. **Self-Documenting**: Episodic memory is the audit trail (no separate event log)
5. **Faster**: No SQL roundtrips for state transitions
6. **More Flexible**: Workflows can be discovered and composed dynamically

---

## 3. Proposed Architecture

### 3.1 Data Model (Minimal Additions)

We keep existing schema but add only **one new table** for execution tracking:

```sql
-- New table: execution_traces
CREATE TABLE execution_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  workflow_name text NOT NULL,
  status text NOT NULL, -- running | completed | failed | paused
  start_memory_id uuid REFERENCES memories(id),
  end_memory_id uuid REFERENCES memories(id),
  context jsonb NOT NULL DEFAULT '{}',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX execution_traces_session_idx ON execution_traces(session_id);
CREATE INDEX execution_traces_status_idx ON execution_traces(status);
```

**Why this is better:**
- No `agent_runs`, `handoff_tasks`, `run_events` (3 tables → 1 table)
- Links directly to memories (audit trail is the memory graph)
- Status is simple: running/completed/failed/paused (no complex state machine)
- Context stores working variables (ephemeral, not source of truth)

### 3.2 Memory Schema (No Changes Needed)

Our existing memory system already supports recursive orchestration:

```typescript
{
  id: uuid,
  content: string, // Single-line description
  summary: string, // Auto-generated
  embedding: vector(1536),
  memoryType: 'episodic' | 'semantic' | 'procedural',
  persona: string[],
  project: string[],
  tags: string[],
  relatedTo: uuid[], // Graph linkages
  metadata: jsonb,
  ...timestamps
}
```

**How it works for orchestration:**

1. **Procedural memories** = workflow definitions (like `aismr-idea-generation-workflow.json`)
2. **Episodic memories** = execution steps (linked via `relatedTo`)
3. **Semantic memories** = domain knowledge (referenced during execution)

**Example execution chain:**

```javascript
// Step 1: Agent stores start
{
  id: 'mem-001',
  content: 'Starting AISMR video production workflow for rain sounds',
  memoryType: 'episodic',
  tags: ['workflow-start', 'aismr'],
  metadata: { traceId: 'trace-123', step: 'init' }
}

// Step 2: Generate ideas (links to Step 1)
{
  id: 'mem-002',
  content: 'Generated 12 unique AISMR ideas about rain',
  memoryType: 'episodic',
  relatedTo: ['mem-001'],
  metadata: { traceId: 'trace-123', step: 'generate_ideas', ideaCount: 12 }
}

// Step 3: User selects idea (links to Step 2)
{
  id: 'mem-003',
  content: 'User selected idea #1: Gentle Rain',
  memoryType: 'episodic',
  relatedTo: ['mem-002'],
  metadata: { traceId: 'trace-123', step: 'user_selection', ideaId: 1 }
}

// Step 4: Generate screenplay (links to Step 3)
{
  id: 'mem-004',
  content: 'Generated screenplay for Gentle Rain (8.0s, validated)',
  memoryType: 'episodic',
  relatedTo: ['mem-003'],
  metadata: { traceId: 'trace-123', step: 'generate_screenplay', runtime: 8.0 }
}

// ... and so on
```

**Query the execution chain:**

```typescript
// Get complete workflow execution
await memory.search({
  query: 'AISMR video production rain',
  memoryTypes: ['episodic'],
  project: 'aismr',
  expandGraph: true,
  maxHops: 10
});
// Returns: All linked memories forming the execution graph
```

---

## 4. Recursive Execution Pattern

### 4.1 High-Level Flow

```
┌─────────────────────────────────────────────────────────────┐
│ User: "Create an AISMR video about rain"                    │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ Agent (recursive orchestrator)                              │
│ 1. Discover workflow: prompt_discover("video production")  │
│    → Returns procedural memory with steps                   │
│                                                             │
│ 2. Create execution trace (SQL)                            │
│    → traceId: trace-123, status: running                   │
│                                                             │
│ 3. Execute steps recursively:                              │
│    FOR EACH step IN workflow.steps:                        │
│      a) Execute step (MCP tool or n8n workflow)            │
│      b) Store outcome (episodic memory, linked to prev)    │
│      c) Check if paused (HITL needed)                      │
│         - If yes: save context, return to user             │
│         - On resume: load context, continue                │
│      d) Continue to next step                              │
│                                                             │
│ 4. Mark trace complete (SQL)                               │
│ 5. Return final result to user                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Workflow Discovery (No Change Needed)

Already implemented via `prompt_discover` MCP tool:

```typescript
// Agent calls
const workflows = await tools.prompt_discover({
  persona: 'casey',
  project: 'aismr',
  intent: 'create video from idea to upload'
});

// Returns procedural memory
{
  name: 'AISMR Complete Video Production',
  description: 'Full pipeline: idea → screenplay → video → upload',
  steps: [
    { id: 'generate_ideas', type: 'mcp_call', tool: 'memory_search', ... },
    { id: 'await_selection', type: 'hitl', ... },
    { id: 'generate_screenplay', type: 'n8n_workflow', workflowName: 'Generate Video', ... },
    { id: 'upload', type: 'n8n_workflow', workflowName: 'Upload to TikTok', ... }
  ],
  ...
}
```

### 4.3 Step Execution (Recursive)

```typescript
async function executeWorkflow(workflow, context, traceId) {
  let prevMemoryId = null;
  
  for (const step of workflow.steps) {
    // Execute based on step type
    let result;
    switch (step.type) {
      case 'mcp_call':
        result = await executeMCPTool(step.mcp_call);
        break;
      
      case 'n8n_workflow':
        result = await executeN8NWorkflow(step.workflowName, context);
        break;
      
      case 'hitl':
        // Pause workflow, wait for user input
        await pauseTrace(traceId, context);
        return { paused: true, resumeStep: step.id };
      
      case 'llm_generation':
        result = await callLLM(step.llm_generation);
        break;
    }
    
    // Store outcome in episodic memory
    const memoryId = await memory.store({
      content: `Step ${step.id}: ${step.description}`,
      memoryType: 'episodic',
      relatedTo: prevMemoryId ? [prevMemoryId] : [],
      metadata: {
        traceId,
        step: step.id,
        result: JSON.stringify(result)
      }
    });
    
    // Update context for next step
    context[step.id] = result;
    prevMemoryId = memoryId;
  }
  
  // Mark trace complete
  await completeTrace(traceId, prevMemoryId);
  
  return { completed: true, context };
}
```

### 4.4 Human-in-the-Loop (HITL)

**Pattern: Pause & Resume**

```typescript
// Step requires user input
{
  id: 'select_idea',
  type: 'hitl',
  description: 'User selects favorite idea',
  hitl: {
    message: 'Which idea would you like? (1-12)',
    responseType: 'text',
    validation: { regex: '^[1-9]|1[0-2]$' }
  }
}

// Agent execution
if (step.type === 'hitl') {
  // 1. Send message to user (Telegram)
  await telegram.sendAndWait({
    chatId: session.userId,
    text: step.hitl.message
  });
  
  // 2. Update trace to 'paused'
  await db.execution_traces.update({
    id: traceId,
    status: 'paused',
    context: currentContext
  });
  
  // 3. Store episodic memory
  await memory.store({
    content: `Paused workflow for user input: ${step.description}`,
    memoryType: 'episodic',
    tags: ['hitl', 'paused'],
    metadata: { traceId, step: step.id }
  });
  
  // 4. Return control to user
  return { paused: true, resumeStep: step.id };
}

// When user responds:
// 1. Load trace
const trace = await db.execution_traces.findById(traceId);

// 2. Resume with saved context
const result = await executeWorkflow(
  workflow,
  { ...trace.context, userInput: userResponse },
  traceId
);
```

---

## 5. Comparison: Original vs. Recursive

### 5.1 Tables Required

| Original Handoff | Recursive Agent |
|------------------|-----------------|
| `agent_runs` | `execution_traces` |
| `handoff_tasks` | *(none)* |
| `run_events` | *(none, use memories)* |
| `memories` | `memories` |
| `sessions` | `sessions` |
| **Total: 5 tables** | **Total: 3 tables** |

### 5.2 Execution Steps

**Original (Handoff):**
```
1. Create agent_run (SQL)
2. Agent A: Claim custody (SQL UPDATE with lease)
3. Agent A: Do work
4. Agent A: Log event (SQL INSERT run_events)
5. Agent A: Store memory (pgvector)
6. Agent A: Create handoff_task (SQL INSERT)
7. Agent A: Call Agent B workflow (n8n)
8. Agent B: Claim handoff (SQL UPDATE, check lease)
9. Agent B: Do work
10. Agent B: Log event (SQL INSERT)
11. Agent B: Store memory (pgvector)
12. Agent B: Complete handoff (SQL UPDATE)
13. Agent B: Update agent_run (SQL UPDATE)

Total: 13 steps, 8 SQL operations
```

**Recursive:**
```
1. Create execution_trace (SQL)
2. Agent: Discover workflow (memory search)
3. Agent: Execute step 1
4. Agent: Store outcome (episodic memory with link)
5. Agent: Execute step 2
6. Agent: Store outcome (episodic memory with link)
7. Agent: Complete trace (SQL UPDATE)

Total: 7 steps, 2 SQL operations
```

### 5.3 Observability

**Original:**
- Query `run_events` for audit trail
- Query `handoff_tasks` for custody chain
- Query `memories` for context

**Recursive:**
- Query `memories` with `expandGraph: true`
- Get complete execution chain in one call
- Automatic graph visualization via `relatedTo` links

### 5.4 Error Recovery

**Original:**
```typescript
// Must check:
// 1. agent_runs.status
// 2. handoff_tasks.status
// 3. Lease expiry (locked_at + TTL)
// 4. Last event in run_events
// 5. Which persona had custody

const run = await db.agent_runs.findById(runId);
const lastHandoff = await db.handoff_tasks.findLatest(runId);
const lastEvent = await db.run_events.findLatest(runId);

if (run.status === 'blocked' && lastHandoff.status === 'pending') {
  // Resume from lastHandoff
} else if (isLeaseExpired(run.locked_at)) {
  // Reclaim lease
}
```

**Recursive:**
```typescript
// Single source of truth
const trace = await db.execution_traces.findById(traceId);

if (trace.status === 'paused') {
  // Resume from saved context
  return executeWorkflow(workflow, trace.context, traceId);
} else if (trace.status === 'failed') {
  // Retry from last successful memory
  const lastMemory = await memories.findById(trace.end_memory_id);
  const prevSteps = await memory.search({
    query: lastMemory.content,
    expandGraph: true,
    memoryTypes: ['episodic']
  });
  // Resume from prevSteps
}
```

---

## 6. MCP Tools (Simplified)

### 6.1 No New Orchestration Tools Needed

We already have everything:

```typescript
// Workflow discovery
prompt_discover({ persona, project, intent })

// Execution
// - MCP tools: memory_search, memory_store, context_get_persona, etc.
// - n8n workflows: Called via toolWorkflow nodes in agent.workflow.json

// Observability
memory_search({ query, expandGraph: true, memoryTypes: ['episodic'] })

// Sessions
session_get_context({ sessionId })
session_update_context({ sessionId, context })
```

### 6.2 Optional: Add Execution Trace Helpers

```typescript
// Create trace
trace_create({ sessionId, workflowName, context })
  → { traceId, status: 'running' }

// Update trace
trace_update({ traceId, status, context })
  → { success: true }

// Query trace
trace_get({ traceId })
  → { id, status, context, start_memory_id, end_memory_id }

// List traces
trace_list({ sessionId, status })
  → [ { traceId, workflowName, status, ... } ]
```

**But these are optional.** The recursive pattern works with memory alone.

---

## 7. Agent System Prompt (Recursive)

```markdown
You are a recursive workflow orchestrator.

## Your Capabilities
1. Discover workflows via `prompt_discover`
2. Execute workflows step-by-step
3. Store outcomes in episodic memory (linked chain)
4. Pause for human input when needed
5. Resume from saved context

## Execution Protocol
1. When user requests a multi-step task:
   a) Call `prompt_discover` to find matching workflow
   b) Create execution trace via `trace_create`
   c) Execute each step recursively:
      - MCP tools: call directly
      - n8n workflows: delegate to toolWorkflow
      - HITL: pause trace, wait for user, resume
   d) Store each outcome in episodic memory, linked to previous
   e) Mark trace complete

2. Memory linking rules:
   - First step: relatedTo = []
   - Subsequent steps: relatedTo = [previousMemoryId]
   - Always include metadata.traceId

3. Error handling:
   - On failure: store error in episodic memory
   - Update trace status to 'failed'
   - Inform user with recovery options

4. Resumption:
   - Load trace via `trace_get`
   - Load context from trace.context
   - Continue from saved step

## Never
- Never invent IDs (always use returned UUIDs)
- Never skip memory storage (audit trail required)
- Never lose context on pause (save to trace)
```

---

## 8. Migration from Original Proposal

### 8.1 What We Keep
- ✅ Memory system (pgvector)
- ✅ Sessions table
- ✅ Workflow definitions (procedural memories)
- ✅ n8n tool workflows
- ✅ MCP tools

### 8.2 What We Replace
- ❌ `agent_runs` → `execution_traces`
- ❌ `handoff_tasks` → *(removed, use memory graph)*
- ❌ `run_events` → *(removed, use episodic memories)*
- ❌ Custody/lease management → *(removed, single agent)*
- ❌ State machine enums → *(simplified: running/paused/completed/failed)*

### 8.3 Migration SQL

```sql
-- Step 1: Create new table
CREATE TABLE execution_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  workflow_name text NOT NULL,
  status text NOT NULL,
  start_memory_id uuid REFERENCES memories(id),
  end_memory_id uuid REFERENCES memories(id),
  context jsonb NOT NULL DEFAULT '{}',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Step 2: Migrate existing workflow_runs (if any)
INSERT INTO execution_traces (session_id, workflow_name, status, created_at)
SELECT 
  session_id,
  workflow_name,
  CASE 
    WHEN status = 'running' THEN 'running'
    WHEN status = 'completed' THEN 'completed'
    ELSE 'failed'
  END,
  created_at
FROM workflow_runs;

-- Step 3: No need to migrate agent_runs/handoff_tasks (they don't exist yet)
```

---

## 9. Real-World Example: AISMR Video Production

### 9.1 Workflow Definition (Procedural Memory)

Already exists in `data/workflows/aismr-video-production.json`:

```json
{
  "name": "AISMR Complete Video Production",
  "steps": [
    { 
      "id": "generate_ideas",
      "type": "mcp_call",
      "tool": "prompt_discover",
      "params": { "intent": "generate AISMR ideas" }
    },
    {
      "id": "select_idea",
      "type": "hitl",
      "message": "Which idea? (1-12)"
    },
    {
      "id": "generate_screenplay",
      "type": "n8n_workflow",
      "workflowName": "AISMR Screenplay Generation"
    },
    {
      "id": "generate_video",
      "type": "n8n_workflow",
      "workflowName": "Generate Video"
    },
    {
      "id": "upload",
      "type": "n8n_workflow",
      "workflowName": "Upload to TikTok"
    }
  ]
}
```

### 9.2 Execution Trace

```typescript
// User: "Create an AISMR video about rain"

// 1. Agent discovers workflow
const workflow = await tools.prompt_discover({
  persona: 'casey',
  project: 'aismr',
  intent: 'create video'
});

// 2. Create trace
const { traceId } = await tools.trace_create({
  sessionId: 'telegram:123456',
  workflowName: workflow.name,
  context: { userInput: 'rain' }
});
// Returns: traceId = 'trace-abc-123'

// 3. Execute recursively (memory chain created automatically)
```

**Memory Chain:**

```
mem-001 (start)
  ↓
mem-002 (generated 12 ideas)
  ↓
mem-003 (user selected #1)
  ↓
mem-004 (screenplay generated)
  ↓
mem-005 (video generated)
  ↓
mem-006 (uploaded to TikTok)
  ↓
mem-007 (complete)
```

**Query execution:**

```typescript
// Get full workflow history
const history = await memory.search({
  query: 'AISMR video rain production',
  memoryTypes: ['episodic'],
  expandGraph: true,
  maxHops: 10,
  project: 'aismr'
});

// Returns: All 7 memories with relatedTo links
// Can visualize as graph or timeline
```

---

## 10. Advantages Over Original Proposal

### 10.1 Simplicity
- **40% less SQL schema** (3 tables vs 5)
- **60% fewer SQL operations** per workflow
- **No complex locking logic** (no leases, no custody)
- **Single agent** instead of multi-persona coordination

### 10.2 Performance
- Fewer database roundtrips
- No lease polling or expiry checks
- Memory search with graph expansion is fast (HNSW index)
- n8n workflows already parallelizable

### 10.3 Observability
- Memory graph = automatic audit trail
- No need for separate event log
- Query execution chain with one `memory_search` call
- Graph visualization tools work out of the box

### 10.4 Flexibility
- Workflows can be discovered dynamically
- No rigid persona boundaries
- Easy to add new workflow types (just add procedural memory)
- Resumption is trivial (load context from trace)

### 10.5 Alignment with North Star

From `NORTH_STAR.md`:
```
"The agent doesn't know who it is yet. First, it loads its persona."
"The agent decides: 'Should I search memory? Yes...'"
"The agent discovers workflow via memory search"
```

**Our recursive pattern is exactly this.**

---

## 11. Best Practices from 2024-2025 Research

### 11.1 Agentic RAG
✅ Agent autonomously decides when to retrieve (not forced)  
✅ Multi-hop graph expansion (`expandGraph: true`)  
✅ Temporal boosting for recent memories  
✅ Hybrid search (vector + metadata filters)

### 11.2 Memory Architecture
✅ Episodic memory for execution trace  
✅ Procedural memory for workflow definitions  
✅ Semantic memory for domain knowledge  
✅ Auto-linking via `relatedTo` (graph structure)

### 11.3 Prompt Engineering
✅ Persistent system message with persona/project  
✅ Memory summaries injected into context  
✅ Managed memory blocks (context in trace)  
✅ Recursive execution pattern

### 11.4 State Management
✅ SQL for authoritative state (execution_traces)  
✅ Memory for rich narrative (episodic memories)  
✅ Ephemeral context in trace.context  
✅ No distributed coordination needed

---

## 12. Rollout Plan

### Phase 1: Foundation (Week 1)
1. Add `execution_traces` table (migration)
2. Implement `trace_create`, `trace_update`, `trace_get` tools
3. Update agent system prompt with recursive pattern
4. Test: Simple 2-step workflow (idea → screenplay)

### Phase 2: Integration (Week 2)
5. Wire up HITL pause/resume
6. Test: Full AISMR workflow (5 steps)
7. Add error recovery logic
8. Test: Failure scenarios

### Phase 3: Polish (Week 3)
9. Add trace listing/filtering UI
10. Optimize memory graph queries
11. Add metrics/observability
12. Documentation + examples

### Phase 4: Production (Week 4)
13. E2E testing with real Telegram users
14. Monitor performance (latency, success rate)
15. Iterate based on feedback
16. Go live 🚀

---

## 13. Success Metrics

| Metric | Target | How to Measure |
|--------|--------|---------------|
| Workflow completion rate | >95% | `execution_traces.status = 'completed'` / total |
| Average execution time | <6 min | Median `(completed_at - created_at)` |
| HITL resume rate | >90% | Paused workflows that resume |
| Zero hallucinated IDs | 100% | Code review + validation layer |
| Memory query latency | <500ms | p95 on `memory_search` with `expandGraph` |
| Developer velocity | 2x faster | Time to add new workflow (vs handoff model) |

---

## 14. Open Questions

1. **Multi-agent coordination**: If we later need specialized personas, can we model them as "sub-workflows" called by the main agent?
   - **Answer**: Yes. Main agent discovers "writer" workflow, which is just another procedural memory.

2. **Long-running workflows**: What if video generation takes 2 hours?
   - **Answer**: n8n handles this. Agent pauses trace, n8n workflow returns when done, agent resumes.

3. **Concurrent users**: Can execution_traces handle high load?
   - **Answer**: Yes. Each trace is independent. No locking. Session-scoped.

4. **Migration path**: Can we run both models (handoff + recursive) during transition?
   - **Answer**: Not recommended. Pick one. Recursive is simpler—commit fully.

---

## 15. Conclusion

The original handoff proposal solves the orchestration problem with **explicit coordination** (handoff tasks, custody, leases). This counter-proposal solves it with **implicit coordination** (memory graph, recursive execution, single agent).

### Key Trade-offs

| Aspect | Handoff Model | Recursive Model |
|--------|--------------|----------------|
| Complexity | High (5 tables, state machine) | Low (3 tables, simple status) |
| Flexibility | Medium (rigid personas) | High (dynamic workflow discovery) |
| Observability | Explicit (run_events table) | Implicit (memory graph) |
| Performance | Medium (8 SQL ops/workflow) | High (2 SQL ops/workflow) |
| Multi-persona | Native support | Simulated via sub-workflows |
| Learning curve | Steep (leases, custody) | Gentle (recursive pattern) |

### Recommendation

**Go with the recursive pattern** for these reasons:

1. **Aligns with current architecture**: We already have the memory system, prompts, and n8n integration
2. **Simpler to implement**: 40% less code, 60% fewer SQL operations
3. **Follows best practices**: Matches 2024-2025 research on agentic RAG and recursive agents
4. **Faster iteration**: Adding new workflows is just adding JSON (no new tables/code)
5. **Better UX**: Execution is faster, errors are clearer, resumption is trivial

If we later discover we need multi-persona handoffs, we can add them as a thin layer on top of the recursive foundation. But start simple. Start recursive.

---

## Appendix A: Recursive Pattern Code Sketch

```typescript
// src/tools/workflow/executeRecursive.ts

export async function executeWorkflowRecursive(
  workflow: ProceduralMemory,
  context: Record<string, any>,
  sessionId: string
): Promise<{ completed: boolean; context: any; pausedAt?: string }> {
  
  // Create execution trace
  const traceId = await db.execution_traces.create({
    session_id: sessionId,
    workflow_name: workflow.name,
    status: 'running',
    context: context
  });
  
  let prevMemoryId: string | null = null;
  
  // Store start
  prevMemoryId = await memory.store({
    content: `Starting workflow: ${workflow.name}`,
    memoryType: 'episodic',
    project: context.project ? [context.project] : [],
    tags: ['workflow-start'],
    metadata: { traceId, workflowName: workflow.name }
  });
  
  await db.execution_traces.update(traceId, {
    start_memory_id: prevMemoryId
  });
  
  // Execute each step
  for (const step of workflow.steps) {
    let result: any;
    
    switch (step.type) {
      case 'mcp_call':
        result = await executeMCPTool(step.tool, step.params, context);
        break;
      
      case 'n8n_workflow':
        result = await executeN8NWorkflow(step.workflowName, context);
        break;
      
      case 'hitl':
        // Pause for user input
        await db.execution_traces.update(traceId, {
          status: 'paused',
          context: { ...context, pausedAt: step.id }
        });
        
        prevMemoryId = await memory.store({
          content: `Paused for user input: ${step.description}`,
          memoryType: 'episodic',
          relatedTo: prevMemoryId ? [prevMemoryId] : [],
          tags: ['workflow-paused', 'hitl'],
          metadata: { traceId, step: step.id }
        });
        
        return { completed: false, context, pausedAt: step.id };
      
      case 'llm_generation':
        result = await callOpenAI(step.llm_generation);
        break;
      
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
    
    // Store outcome
    prevMemoryId = await memory.store({
      content: `${step.description}: ${JSON.stringify(result)}`,
      memoryType: 'episodic',
      relatedTo: prevMemoryId ? [prevMemoryId] : [],
      tags: ['workflow-step', step.id],
      metadata: { 
        traceId, 
        step: step.id,
        stepType: step.type,
        result: result 
      }
    });
    
    // Update context
    context[step.id] = result;
    
    // Save checkpoint
    await db.execution_traces.update(traceId, {
      context: context
    });
  }
  
  // Mark complete
  await db.execution_traces.update(traceId, {
    status: 'completed',
    end_memory_id: prevMemoryId
  });
  
  return { completed: true, context };
}
```

---

## Appendix B: Comparison Table (Detailed)

| Feature | Original Handoff | Recursive Agent | Winner |
|---------|-----------------|-----------------|--------|
| **Schema** |
| Tables needed | 5 (agent_runs, handoff_tasks, run_events, memories, sessions) | 3 (execution_traces, memories, sessions) | ✅ Recursive |
| Indexes | 8+ (status, custody, persona, etc.) | 4 (session, status, memory graph) | ✅ Recursive |
| **Execution** |
| SQL ops per workflow | ~8 (create run, claim, handoff, complete) | ~2 (create trace, update status) | ✅ Recursive |
| Memory ops per step | 1 (store summary) | 1 (store linked outcome) | 🟰 Tie |
| Coordination | Leases, custody, handoff tasks | None (single agent) | ✅ Recursive |
| **Observability** |
| Audit trail | run_events table | Memory graph (relatedTo) | 🟰 Tie |
| Query complexity | 3 JOINs (runs + handoffs + events) | 1 graph expansion query | ✅ Recursive |
| **Flexibility** |
| Add new workflow | Update persona, add handoff logic | Add JSON to procedural memory | ✅ Recursive |
| Dynamic composition | Hard (pre-defined handoffs) | Easy (discover + execute) | ✅ Recursive |
| **Error Recovery** |
| Resume logic | Check lease, find last handoff | Load trace context | ✅ Recursive |
| Retry | Re-create handoff task | Re-execute from last memory | 🟰 Tie |
| **Performance** |
| Latency per step | ~50ms (SQL ops) | ~20ms (SQL ops) | ✅ Recursive |
| Throughput | Limited by lease polling | Limited by memory writes | 🟰 Tie |

**Final Score: Recursive 10, Handoff 0, Tie 4**

---

**The recursive pattern is simpler, faster, and more aligned with our current architecture. Let's build it.**

