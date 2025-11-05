# MCP Tools Reference

The agent has **12 tools** for memory, workflows, context management, and documentation lookup.

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
  limit?: number;             // Max results (default: 10)
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
  "temporalBoost": true,
  "limit": 10
}
```

---

### memory_store

Store a new memory with auto-summarization and auto-linking.

**Parameters:**
```typescript
{
  content: string;                    // Memory content (single line)
  memoryType: 'episodic' | 'semantic' | 'procedural';
  persona?: string[];                 // Associated personas
  project?: string[];                 // Associated projects
  tags?: string[];                    // Categorization tags
  relatedTo?: string[];               // Manual links to other memories
  metadata?: Record<string, unknown>; // Additional data
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
  "tags": ["idea-generation", "user-preference"]
}
```

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

## Workflow Tools

### workflow_discover

Discover workflows by semantic intent (not by name).

**Parameters:**
```typescript
{
  intent: string;        // Natural language intent
  project?: string;      // Filter by project
  persona?: string;      // Filter by persona
  limit?: number;        // Max results (default: 10)
}
```

**Returns:**
```typescript
{
  workflows: Array<{
    workflowId: string;
    name: string;
    description: string;
    relevanceScore: number;
    workflow: WorkflowDefinition;
  }>;
  totalFound: number;
  searchTime: number;
}
```

**Example:**
```json
{
  "intent": "create complete AISMR video from idea to upload",
  "project": "aismr"
}
```

---

### workflow_execute

Execute a discovered workflow.

**Parameters:**
```typescript
{
  workflowId: string;              // From workflow_discover
  input: Record<string, unknown>;  // Workflow inputs
  sessionId?: string;              // For tracking
  waitForCompletion?: boolean;     // Block until done (default: false)
}
```

**Returns:**
```typescript
{
  workflowRunId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: Record<string, unknown>;
  error?: string;
}
```

**Example:**
```json
{
  "workflowId": "workflow-abc-123",
  "input": {
    "userInput": "rain sounds",
    "ideaCount": 12
  },
  "sessionId": "telegram:6559268788",
  "waitForCompletion": true
}
```

---

### workflow_status

Check workflow execution status.

**Parameters:**
```typescript
{
  workflowRunId: string; // From workflow_execute
}
```

**Returns:**
```typescript
{
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  output?: Record<string, unknown>;
  error?: string;
}
```

---

## Interaction Tools

### clarify_ask

Ask user for clarification when request is ambiguous.

**Parameters:**
```typescript
{
  question: string;
  suggestedOptions?: string[]; // Optional multiple choice
}
```

**Returns:**
```typescript
{
  question: string;
  formatted: string; // Formatted with options
  needsResponse: boolean;
}
```

**Example:**
```json
{
  "question": "What would you like to create for AISMR?",
  "suggestedOptions": [
    "Generate new video ideas",
    "Write a screenplay",
    "Check video status"
  ]
}
```

---

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

## Documentation Tools

### docs_lookup

Search documentation via Context7 for OpenAI, n8n, MCP, and internal docs.

**Parameters:**
```typescript
{
  query: string;              // Documentation query
  library?: string;           // Specific library to search (e.g., "n8n", "openai")
  tokens?: number;            // Max tokens to retrieve (default: 5000)
}
```

**Returns:**
```typescript
{
  content: string;            // Documentation content
  note?: string;             // Implementation note
  query: string;
  library?: string;
}
```

**Example:**
```json
{
  "query": "How to execute n8n workflows via API",
  "library": "n8n",
  "tokens": 5000
}
```

**Note:** Context7 integration is currently a placeholder. Full implementation coming soon.

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

### Discovering & Executing Workflow

```typescript
// Find workflow by intent
const discovery = await workflow_discover({
  intent: 'generate AISMR video ideas',
  project: 'aismr'
});

// Execute best match
const execution = await workflow_execute({
  workflowId: discovery.workflows[0].workflowId,
  input: { userInput: 'rain sounds' },
  sessionId,
  waitForCompletion: true
});
```

### Storing Interaction

```typescript
// Remember what happened
await memory_store({
  content: `Generated 12 ideas, user selected "Gentle Rain", workflow run: ${execution.workflowRunId}`,
  memoryType: 'episodic',
  project: ['aismr'],
  tags: ['workflow-execution', 'idea-generation']
});
```

---

## Performance

All tools are optimized for speed:

- `memory_search`: < 100ms (p95)
- `workflow_discover`: < 200ms (p95)
- `memory_store`: ~500ms (includes embedding generation)
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
- `WORKFLOW_ERROR` - Workflow not found or execution failed

OpenAI calls automatically retry on rate limits and network errors.
