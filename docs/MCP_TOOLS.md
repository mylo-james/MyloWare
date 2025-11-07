# MCP Tools Reference

The agent has **11 tools** covering memory, context, sessions, and trace coordination.

---

## Memory Tools

### memory_search

Search memories using hybrid vector + keyword retrieval.

**Parameters:**
```typescript
{
  query: string;              // Search query
  memoryTypes?: string[];     // ['episodic', 'semantic', 'procedural']
  project?: string;           // Filter by project
  persona?: string;           // Filter by persona
  traceId?: string;           // Filter by traceId metadata (new)
  limit?: number;             // Max results (default: 10)
  offset?: number;            // Skip N newest results (default: 0)
  minSimilarity?: number;     // Threshold 0-1 (default: none)
  temporalBoost?: boolean;    // Boost recent (default: false)
  expandGraph?: boolean;      // Follow links (default: false)
  maxHops?: number;           // Graph hops (default: 2)
}
```

**Returns:**
```typescript
{
  memories: Memory[];
  totalFound: number;
  searchTime: number; // milliseconds
}
```

**Example:**
```json
{
  "query": "AISMR rain ideas",
  "memoryTypes": ["episodic", "semantic"],
  "project": "aismr",
  "traceId": "trace-aismr-001",
  "temporalBoost": true,
  "limit": 10
}
```

When `traceId` is provided, the tool skips vector search and returns the newest matching memories (ordered by `createdAt DESC`) so agents can replay the execution trace. Use `offset` to paginate through long traces (e.g., `limit:10, offset:10` to fetch the second page).

---

### memory_store

Store a new memory with auto-summarization and auto-linking.

**Parameters:**
```typescript
{
  content: string;                    // Memory content (single line)
  memoryType: 'episodic' | 'semantic' | 'procedural';
  persona?: string[];                 // Associated personas (ALWAYS pass as an array, even for a single value)
  project?: string[];                 // Associated projects (ALWAYS pass as an array)
  tags?: string[];                    // Categorization tags (ALWAYS pass as an array)
  relatedTo?: string[];               // Manual links to other memories (ALWAYS pass as an array)
  metadata?: Record<string, unknown>; // Additional data
  traceId?: string;                   // Convenience field stored in metadata
  runId?: string;                     // Legacy compatibility helper
  handoffId?: string;                 // Optional correlation ID for handoffs
}
```

**Automatic Features:**
- Generates vector embedding (text-embedding-3-small)
- Summarizes content >100 chars (gpt-4o-mini)
- Detects and links top 5 similar memories
- Creates full-text search index

**Returns:** Complete memory object with ID

**Example:**
```json
{
  "content": "Generated 12 AISMR ideas about rain sounds, user preferred gentle rain",
  "memoryType": "episodic",
  "project": ["aismr"],
  "persona": ["iggy"],
  "tags": ["idea-generation", "user-preference"],
  "traceId": "trace-aismr-001"
}
```

> ⚠️ Always pass array fields (`project`, `persona`, `tags`, `relatedTo`) as JSON arrays, even if you only have a single value. Omit optional fields instead of sending empty strings—this prevents schema validation failures inside the MCP server.

---

### memory_evolve

Update existing memory (tags, links, summary).

**Parameters:**
```typescript
{
  memoryId: string;
  updates: {
    addTags?: string[];
    removeTags?: string[];
    addLinks?: string[];      // Memory IDs to link
    removeLinks?: string[];
    updateSummary?: string;
  };
}
```

**Returns:**
```typescript
{
  success: boolean;
  memory: Memory;
  changes: string[]; // List of changes made
}
```

---

### memory_searchByRun

Search memories captured under a legacy `runId` (stored in `metadata.runId`). Use this when replaying pre-trace workflows or when debugging Casey’s earlier handoffs.

**Parameters:**
```typescript
{
  runId: string;        // Required run identifier
  persona?: string;     // Optional persona filter
  project?: string;     // Optional project filter
  k?: number;           // Max results (default 20)
}
```

**Returns:**
```typescript
{
  memories: Memory[];   // Embeddings removed for safety
  totalFound: number;
  searchTime: number;   // milliseconds
}
```

**Example:**
```json
{
  "runId": "run-aismr-42",
  "persona": "casey",
  "project": "aismr",
  "k": 5
}
```

**Usage:** Call this when you need to migrate or audit historical runs that predate trace IDs. New workflows should prefer `memory_search` with `traceId` filters.

---

## Context Tools

### context_get_persona

Load AI persona configuration.

**Parameters:**
```typescript
{
  personaName: string; // 'casey', 'ideagenerator', 'screenwriter'
}
```

**Returns:**
```typescript
{
  name: string;
  title: string;
  role: string;
  systemPrompt: string;
  capabilities: string[];
  defaultProject: string;
}
```

**Available Personas:**
- `casey` - Conversational orchestrator
- `ideagenerator` - AISMR idea generator
- `screenwriter` - AISMR screenplay writer

---

### context_get_project

Load project configuration and guardrails.

**Parameters:**
```typescript
{
  projectName: string; // 'aismr', 'general'
}
```

**Returns:**
```typescript
{
  name: string;
  description: string;
  workflows: string[];
  guardrails: Record<string, any>;
  settings: Record<string, any>;
}
```

**Available Projects:**
- `aismr` - AI ASMR video production
- `general` - Fallback for general conversations

---

## Trace Coordination Tools (Epic 1)

### trace_create

Create a new execution trace to coordinate multi-agent workflows.

**Parameters:**
```typescript
{
  projectId: string;     // Project identifier (e.g., 'aismr', 'genreact')
  sessionId?: string;    // Optional session reference
  metadata?: Record<string, unknown>; // Additional context
}
```

**Returns:**
```typescript
{
  traceId: string;       // Unique trace identifier (UUID)
  status: string;        // 'active'
  createdAt: string;     // ISO timestamp
}
```

**Example:**
```json
{
  "projectId": "aismr",
  "sessionId": "telegram:6559268788",
  "metadata": {
    "object": "candles",
    "userRequest": "Create AISMR video about candles"
  }
}
```

**Usage:** Casey creates a trace at the start of a production run. All downstream agents tag their memories with this `traceId`.

---

### handoff_to_agent

Hand off work to another agent via n8n webhook invocation.

**Parameters:**
```typescript
{
  traceId: string;       // Active trace ID
  toAgent: string;       // Target agent ('iggy', 'riley', 'veo', 'alex', 'quinn')
  instructions: string;  // Natural language instructions for the agent
  metadata?: Record<string, unknown>; // Additional context (will be forwarded to the webhook payload)
}
```

**Returns:**
```typescript
{
  webhookUrl: string;    // The invoked webhook URL
  executionId?: string;  // n8n execution ID (if available)
  status: string;        // 'invoked' or 'failed'
  toAgent: string;       // Echo of target agent
}
```

**Example:**
```json
{
  "traceId": "trace-aismr-001",
  "toAgent": "iggy",
  "instructions": "Generate 12 surreal modifiers for candles. Make sure they're unique and validated against our archive.",
  "metadata": {
    "object": "candles"
  }
}
```

**Usage:** Any agent can hand off to another. The tool validates the trace is active, looks up the agent's webhook, invokes it, and stores the handoff event to memory.

---

### workflow_complete

Signal that a workflow trace has completed (or failed).

**Parameters:**
```typescript
{
  traceId: string;       // Active trace ID
  status: 'completed' | 'failed';
  outputs?: Record<string, unknown>; // Final outputs
  notes?: string;        // Optional completion notes
}
```

**Returns:**
```typescript
{
  traceId: string;       // Echo of trace ID
  status: string;        // 'completed' or 'failed'
  completedAt: string;   // ISO timestamp
  outputs?: Record<string, unknown>;
}
```

**Example:**
```json
{
  "traceId": "trace-aismr-001",
  "status": "completed",
  "outputs": {
    "postUrl": "https://tiktok.com/@mylo_aismr/video/7234567890",
    "platform": "tiktok",
    "duration": 110
  },
  "notes": "Published successfully to TikTok"
}
```

**Usage:** The final agent (typically Quinn) calls this after publishing is complete. Casey receives the completion signal and notifies the user.

---

## Session Tools

### session_get_context

Load session working memory.

**Parameters:**
```typescript
{
  sessionId: string; // Format: "telegram:6559268788"
}
```

**Returns:**
```typescript
{
  session: {
    id: string;
    userId: string;
    persona: string;
    project: string;
    lastInteractionAt: string;
  };
  context: {
    lastIntent?: string;
    lastWorkflowRun?: string;
    recentTopics?: string[];
    preferences?: Record<string, unknown>;
    conversationHistory?: Array<{
      role: 'user' | 'assistant';
      content: string;
      timestamp: string;
    }>;
  };
}
```

---

### session_update_context

Update session working memory.

**Parameters:**
```typescript
{
  sessionId: string;
  context: {
    lastIntent?: string;
    lastWorkflowRun?: string;
    recentTopics?: string[];
    preferences?: Record<string, unknown>;
  };
}
```

**Returns:**
```typescript
{
  success: boolean;
}
```

---

## Usage Patterns

### Loading Context

```typescript
// Start of conversation
const persona = await context_get_persona({ personaName: 'chat' });
const project = await context_get_project({ projectName: 'aismr' });
const session = await session_get_context({ sessionId });
```

### Searching Memory

```typescript
// Find relevant past context
const pastIdeas = await memory_search({
  query: 'AISMR rain ideas',
  memoryTypes: ['episodic'],
  project: 'aismr',
  temporalBoost: true,
  limit: 10
});
```

### Coordinating Multi-Agent Workflow

```typescript
// 1. Casey creates trace
const trace = await trace_create({
  projectId: 'aismr',
  sessionId: 'telegram:6559268788',
  metadata: { object: 'candles' }
});
// Returns: { traceId: 'trace-aismr-001', ... }

// 2. Casey hands off to Iggy
const handoff = await handoff_to_agent({
  traceId: trace.traceId,
  toAgent: 'iggy',
  instructions: 'Generate 12 surreal candle modifiers. Validate uniqueness.',
  metadata: { object: 'candles' }
});
// Returns: { webhookUrl: '...', executionId: '...', status: 'invoked' }

// 3. Iggy generates modifiers, stores to memory
await memory_store({
  content: 'Generated 12 surreal candle modifiers: Void, Liquid, Crystal...',
  memoryType: 'episodic',
  project: ['aismr'],
  persona: ['iggy'],
  tags: ['ideas-generated', 'candles'],
  metadata: {
    traceId: trace.traceId,  // KEY: Tag with traceId
    modifiers: [...]
  }
});

// 4. Iggy hands off to Riley
await handoff_to_agent({
  traceId: trace.traceId,
  toAgent: 'riley',
  instructions: 'Write 12 screenplays for the candle modifiers. Find details in my last memory.'
});

// ... chain continues through Riley → Veo → Alex → Quinn ...

// 5. Quinn signals completion
await workflow_complete({
  traceId: trace.traceId,
  status: 'completed',
  outputs: {
    postUrl: 'https://tiktok.com/@mylo_aismr/video/...',
    platform: 'tiktok'
  }
});

// 6. Casey receives completion and notifies user
```

---

## Performance

All tools are optimized for speed:

- `memory_search`: < 100ms (p95)
- `memory_store`: ~500ms (includes embedding generation)
- `trace_create`: < 20ms (p95)
- `handoff_to_agent`: < 500ms (includes webhook invocation)
- `workflow_complete`: < 50ms (p95)
- Other tools: < 50ms (p95)

Monitor via `/metrics` endpoint.

---

## Error Handling

All tools return structured errors:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Query contains newlines",
    "field": "query"
  }
}
```

**Common Error Codes:**
- `VALIDATION_ERROR` - Invalid input parameters
- `DATABASE_ERROR` - Database operation failed
- `OPENAI_ERROR` - OpenAI API call failed
- `TRACE_ERROR` - Trace not found or invalid
- `AGENT_ERROR` - Agent webhook not found or invocation failed

OpenAI calls and webhook invocations automatically retry on rate limits and network errors.
