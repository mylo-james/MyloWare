# The Journey to V2: A Modern Agentic RAG System

> **"What if workflows were memories, and the agent could dream about what to do next?"**

---

## 🌅 Prologue: Why We're Here

### The V1 Story

In V1, we built something ambitious—perhaps too ambitious. We created a complex web of specialized n8n workflows, each hardcoded with specific logic. The `chat.workflow.json` had three workflow tools baked directly into it. To add a new workflow meant editing code, updating connections, and manually wiring everything together. It worked, but it was rigid, brittle, and felt like we were fighting against the system rather than working with it.

We realized something profound: **Workflows shouldn't be code. They should be memories.** And memories should be discoverable, searchable, and evolvable.

### The Vision for V2

Imagine a system so elegant that when a user says "create an AISMR video about rain," the AI doesn't consult a hardcoded decision tree. Instead, it:

1. **Searches its memory** for what "create AISMR video" means
2. **Discovers the workflow** semantically—finding it by understanding intent, not matching strings
3. **Asks clarifying questions** if the request is ambiguous
4. **Executes the workflow** dynamically
5. **Remembers the interaction** for next time

This is the essence of **Agentic RAG**—retrieval-augmented generation where the agent autonomously decides _when_ to retrieve, _what_ to retrieve, and _how_ to use what it retrieves.

V2 is our fresh start. A ground-up rebuild incorporating the latest RAG research from 2024-2025, semantic workflow architecture, and conversational agent patterns. This time, we're not building a system. We're building an agent that thinks.

---

## 📖 Part I: The Architecture

### Chapter 1: The Single Agent

At the heart of V2 is a radical simplification: **one agent node**.

No more maze of specialized workflows. No more hardcoded connections. Just a single, intelligent agent with access to a powerful memory system and the ability to call tools.

**The Agent's World** (`workflows/agent.workflow.json`)

```
┌─────────────────────────────────────────────┐
│          THE AGENT                          │
│                                             │
│  "I am Casey. I help Mylo create content." │
│                                             │
│  My Tools:                                  │
│  • memory.search - find what I need         │
│  • memory.store - remember for later        │
│  • context.get_persona - who am I?          │
│  • context.get_project - what are we doing? │
│  • workflow.discover - what process fits?   │
│  • workflow.execute - make it happen        │
│  • clarify.ask - I need more information    │
│                                             │
│  My Process:                                │
│  1. Understand what you're asking           │
│  2. Ask questions if I'm unsure             │
│  3. Search my memory for context            │
│  4. Find the right workflow                 │
│  5. Execute it                              │
│  6. Remember what happened                  │
└─────────────────────────────────────────────┘
```

The agent doesn't follow a script. It reasons. It decides. It acts.

### Chapter 1.5: Infrastructure Philosophy

**Critical Principles:**

#### Docker Compose Architecture

**Three Services, One Compose File**

Everything runs via `docker compose up`. Simple deployment, easy development, clear separation of concerns.

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: pgvector/pgvector:pg16
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=memories
      - POSTGRES_USER=mylo
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    healthcheck:
      test: ['CMD', 'pg_isready', '-U', 'mylo']
      interval: 10s
      timeout: 5s
      retries: 5
    ports:
      - '5432:5432'

  mcp-server:
    build:
      context: .
      target: mcp-server
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      - DATABASE_URL=postgresql://mylo:${DB_PASSWORD}@postgres:5432/memories
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - MCP_AUTH_KEY=${MCP_AUTH_KEY}
    ports:
      - '3000:3000'
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:3000/health']
      interval: 10s
      timeout: 5s
      retries: 5

  n8n:
    image: n8nio/n8n:latest
    depends_on:
      - postgres
      - mcp-server
    environment:
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=postgres
      - DB_POSTGRESDB_DATABASE=n8n
      - DB_POSTGRESDB_USER=mylo
      - DB_POSTGRESDB_PASSWORD=${DB_PASSWORD}
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=${N8N_USER}
      - N8N_BASIC_AUTH_PASSWORD=${N8N_PASSWORD}
      - N8N_METRICS=true
      - N8N_LOG_LEVEL=info
      - QUEUE_HEALTH_CHECK_ACTIVE=true
      - N8N_CONCURRENCY_PRODUCTION_LIMIT=10
      - WEBHOOK_URL=https://n8n.yourdomain.com
    ports:
      - '5678:5678'
    volumes:
      - n8n_data:/home/node/.n8n
      - ./workflows:/home/node/.n8n/workflows
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:5678/healthz']
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  n8n_data:
```

**Why This Architecture:**

- **Postgres** - Isolated database service with persistent volumes
- **MCP Server** - Stateless tool interface, independently scalable
- **n8n** - Workflow engine for programmatic operations (video queuing, TikTok posting)
  - Provides UI for workflow visualization and debugging
  - Handles observability and monitoring
  - Executes non-AI operations reliably

**Development Commands:**

```bash
# Start everything
docker compose up

# Stop everything
docker compose down

# Reset everything (including data)
docker compose down -v

# View logs
docker compose logs -f

# Restart a service
docker compose restart mcp-server
```

#### Component-Based Tools

Every MCP tool is like a React component:

```typescript
// Tools receive props
interface MemorySearchProps {
  query: string;
  memoryTypes?: MemoryType[];
  project?: string;
  persona?: string;
}

// Tools use DB as state management (like Redux/Zustand)
async function memory.search(props: MemorySearchProps) {
  // Read from DB state
  const memories = await db.memories.search(props);

  // Update DB state
  await db.memories.updateAccessCount(memories.map(m => m.id));

  // Return data
  return memories;
}
```

**Component Principles:**

- ✅ Props-based interface (typed parameters)
- ✅ DB as state management (single source of truth)
- ✅ Pure functions (same input = same output)
- ✅ Composable (tools can call other tools)
- ✅ Testable (mock DB, test logic)
- ✅ **⚠️ CRITICAL: Single-line JSON for AI-facing text (see below)**

#### Single-Line JSON for AI-Facing Data

**Rule: Text stored in DB for AI consumption must be single-line.**

**Why:**

- Embeddings work better without `\n` noise
- Agent parsing is more reliable
- Token efficiency in prompts
- Cleaner tool composition

**Where it applies:**

- ✅ Memory content (episodic, semantic, procedural)
- ✅ Workflow definitions
- ✅ Agent summaries
- ✅ Semantic search indices

**Where it does NOT apply:**

- ❌ User-facing messages (Telegram, web UI)
- ❌ Logs and debug output
- ❌ Documentation
- ❌ Error messages

**Implementation:**

```typescript
// Clean user input before storing in DB
const userInput = telegramMessage.text;
const cleanedForDB = userInput.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

// Store in DB
await memory.store({
  content: cleanedForDB, // Single-line for AI
  memoryType: 'episodic',
});

// But send nicely formatted text to user
await telegram.sendMessage({
  text: `Here are your ideas:
1. Gentle Rain
2. Storm Window
3. Rain Puddle`, // Multi-line OK for user
});
```

**Enforcement:**

```sql
-- Database check constraint
ALTER TABLE memories ADD CONSTRAINT no_newlines_in_content
  CHECK (content !~ '\n');
```

```typescript
// Validation utility (use for DB-bound text)
function cleanForAI(text: string): string {
  return text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}
```

#### V1 as Inspiration, Not Template

V1 code lives in `v1/` directory. Use it as:

- ✅ **Reference** - "How did we solve X?"
- ✅ **Pattern inspiration** - "This pattern works well"
- ✅ **Test cases** - "What scenarios did we cover?"

Do NOT:

- ❌ Copy-paste V1 code
- ❌ Bring V1 technical debt
- ❌ Replicate V1 complexity

**Learn from V1, don't clone it.**

### Chapter 2: The Memory System

In V2, memory is structured into **three types**, inspired by human cognition and recent RAG research:

#### Episodic Memory

_"What happened?"_

Every conversation, every interaction, every workflow execution. Timestamped, tagged, and searchable. The agent remembers that you asked about rain sounds yesterday, that the video generated successfully, that you preferred gentle whispers over loud tapping.

```json
{
  "content": "Generated 12 AISMR ideas about rain sounds",
  "memoryType": "episodic",
  "persona": "casey",
  "project": "aismr",
  "tags": ["idea-generation", "rain-sounds"],
  "timestamp": "2025-11-05T14:32:00Z",
  "relatedTo": ["workflow-run-123", "previous-video-456"]
}
```

#### Semantic Memory

_"What do I know?"_

Facts, documentation, rules, specifications. The knowledge base. This is where AISMR's 8-second runtime requirement lives. Where the "two-word descriptor + object" format is documented. Where the agent learns what makes a good AISMR video.

```json
{
  "content": "AISMR videos must be exactly 8.0 seconds long, with whisper at 3.0 seconds",
  "memoryType": "semantic",
  "project": "aismr",
  "tags": ["specification", "timing", "runtime"],
  "relatedTo": ["aismr-quality-guidelines"]
}
```

#### Procedural Memory

_"How do I do this?"_

Workflows, processes, step-by-step instructions. This is the revolutionary part: **workflows as memories**. The agent doesn't have workflows baked in—it discovers them by searching procedural memory.

```json
{
  "title": "AISMR Idea Generation Workflow",
  "memoryType": "procedural",
  "project": "aismr",
  "workflow": {
    "steps": [
      "Search for past ideas to avoid duplicates",
      "Generate 12 new unique ideas",
      "Validate against archive",
      "Store results"
    ]
  }
}
```

### Chapter 3: The Database Architecture

V2 uses a **dual-database approach**, each optimized for its purpose:

#### Vector Database (pgvector)

_"The Agent's Mind"_

This is where memories live. Rich, searchable, semantically indexed. Every memory has:

- **Content** - What happened, what's known, how to do it
- **Embedding** - Vector representation for semantic search
- **Text Search** - Keyword indices for hybrid retrieval
- **Metadata** - Persona, project, tags, timestamps
- **Links** - Connections to related memories (from A-Mem research)

**The `memories` Table:**

```sql
CREATE TABLE memories (
  id UUID PRIMARY KEY,
  content TEXT NOT NULL CHECK (content !~ '\n'), -- ⚠️ Single-line for AI
  summary TEXT CHECK (summary IS NULL OR summary !~ '\n'),
  embedding VECTOR(1536),
  textsearch TSVECTOR,

  memory_type memory_type NOT NULL, -- episodic, semantic, procedural

  -- Context filters
  persona TEXT[],
  project TEXT[],
  tags TEXT[],

  -- Memory graph (from A-Mem research)
  related_to UUID[],

  -- Temporal metadata
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  access_count INTEGER,

  metadata JSONB
);

-- ⚠️ CRITICAL: Use HNSW for better performance
CREATE INDEX idx_memories_embedding
ON memories USING hnsw(embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Set storage to avoid TOAST overhead
ALTER TABLE memories ALTER COLUMN embedding SET STORAGE PLAIN;

-- Configure search parameters
SET hnsw.ef_search = 100;

-- Hybrid search index (keyword)
CREATE INDEX idx_memories_textsearch
ON memories USING GIN(textsearch);

-- Metadata indices
CREATE INDEX idx_memories_type ON memories(memory_type);
CREATE INDEX idx_memories_persona ON memories USING GIN(persona);
CREATE INDEX idx_memories_project ON memories USING GIN(project);
CREATE INDEX idx_memories_tags ON memories USING GIN(tags);
CREATE INDEX idx_memories_temporal ON memories(created_at DESC);
CREATE INDEX idx_memories_links ON memories USING GIN(related_to);

-- Partial index for AISMR-specific queries
CREATE INDEX idx_aismr_memories
ON memories USING hnsw(embedding vector_cosine_ops)
WHERE 'aismr' = ANY(project);
```

**pgvector Optimization Strategy:**

Based on official pgvector documentation:

1. **HNSW vs IVFFlat**: HNSW provides better recall and performance for most use cases
2. **Storage**: Set `STORAGE PLAIN` to avoid TOAST overhead
3. **Search tuning**: Adjust `hnsw.ef_search` (higher = better recall, slower)
4. **Monitoring**: Use `pg_stat_statements` to track query performance
5. **Partial indices**: Create project-specific indices for frequently filtered queries

```sql
-- Monitor slow queries
CREATE EXTENSION pg_stat_statements;

SELECT query, mean_exec_time, calls
FROM pg_stat_statements
WHERE query LIKE '%memories%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

#### SQL Database (Postgres)

_"The Agent's State Management"_

This tracks the agent's actions—workflow runs, session state, execution history. When the agent triggers a workflow, it gets recorded here. When you ask "how's my video?", the agent queries this database.

**Key Tables:**

- `sessions` - Conversation state, working memory
- `workflow_runs` - Execution tracking
- `personas` - Identity configurations
- `projects` - Project-specific settings

### Chapter 4: The Tool Interface (MCP)

The Model Context Protocol (MCP) is how the agent interacts with its memory system. In V2, we consolidate dozens of fragmented tools into a clean, semantic interface.

#### Memory Tools

**`memory.search`** - The Universal Search

```typescript
// Find anything across all memory types
memory.search({
  query: 'generate ideas aismr',
  memoryTypes: ['procedural', 'episodic'],
  project: 'aismr',
  searchMode: 'hybrid', // vector + keyword
  temporalBoost: true, // recent memories rank higher
});
```

**`memory.store`** - Rich Storage

```typescript
// Store with automatic linking and summarization
memory.store({
  content: cleanForAI('Generated 12 ideas about cozy blankets'),
  memoryType: 'episodic',
  project: 'aismr',
  tags: ['idea-generation', 'blankets'],
  relatedTo: ['workflow-run-456'], // Auto-linked to workflow
});
```

**`memory.evolve`** - Dynamic Updates (from A-Mem research)

```typescript
// Memories aren't static—they evolve
memory.evolve({
  memoryId: 'memory-123',
  updates: {
    addTags: ['successful', 'user-approved'],
    addLinks: ['related-video-789'],
    updateSummary: 'Highly successful idea generation',
  },
});
```

#### Context Tools

**`context.get_persona`** - Identity Loading

```typescript
// Load the agent's persona configuration
context.get_persona({
  personaName: 'casey',
});
// Returns: tone, capabilities, default behaviors
```

**`context.get_project`** - Project Context

```typescript
// Load project-specific settings
context.get_project({
  projectName: 'aismr',
});
// Returns: workflows, guardrails, specifications
```

#### Workflow Tools

**`workflow.discover`** - Semantic Discovery

```typescript
// Find workflows by intent, not by name
workflow.discover({
  intent: 'generate video ideas',
  project: 'aismr',
});
// Returns: [{name, description, steps, relevance_score}]
```

**`workflow.execute`** - Dynamic Execution

```typescript
// Execute any discovered workflow
workflow.execute({
  workflowName: 'AISMR Idea Generation',
  input: { userIdea: 'rain sounds' },
  waitForCompletion: false,
});
// Returns: {workflowRunId, status}
```

#### Interaction Tools

**`clarify.ask`** - Conversational Agent

```typescript
// Ask the user for clarification
clarify.ask({
  question: 'What would you like to create for AISMR?',
  suggestedOptions: [
    'Generate new video ideas',
    'Write a script',
    'Check video status',
  ],
});
// Pauses execution, waits for user response
```

#### Documentation Tools

**`docs.lookup`** - Context7 Integration

**CRITICAL**: The AI should **always** look up documentation via Context7 before attempting tasks. Err on the side of looking things up.

```typescript
// Look up ANY library or framework documentation
docs.lookup({
  library: 'react',
  topic: 'hooks useEffect',
  version: '18.2.0', // optional
});
// Returns: Latest, authoritative documentation from Context7

// Examples:
docs.lookup({ library: 'openai', topic: 'embeddings API' });
docs.lookup({ library: 'postgres', topic: 'vector indexes' });
docs.lookup({ library: 'n8n', topic: 'custom nodes' });
```

**Why Context7:**

- Always up-to-date documentation
- Multiple libraries in one interface
- Semantic search across docs
- No stale local copies

**Agent Instruction:**

```
Before implementing any library-specific code, use docs.lookup to verify:
- Current API syntax
- Best practices
- Breaking changes
- Configuration options

When in doubt, look it up. Documentation is cheap, bugs are expensive.
```

### Chapter 5: The n8n Integration

**n8n's Role in V2:**

n8n handles **programmatic workflows** that don't require AI decision-making:

- **Video queuing** - Batch processing, rate limiting
- **TikTok posting** - Authentication, file upload, API calls
- **Email notifications** - Triggered alerts
- **Scheduled tasks** - Daily archival, cleanup

**Benefits:**

- **UI** - Visual workflow editor for debugging and monitoring
- **Observability** - Built-in execution history, error tracking
- **Reliability** - Retries, error handling, webhook management
- **Metrics** - Performance tracking, health checks

**Agent ↔ n8n Flow:**

```
User: "Create an AISMR video about rain"
  ↓
Agent (MCP):
  1. Searches memories
  2. Discovers workflow
  3. Generates ideas (AI task)
  4. User selects idea
  5. Generates screenplay (AI task)
  6. ⚡ Calls n8n workflow for video generation
     ↓
n8n Workflow:
  - Calls external video API
  - Monitors generation progress
  - Downloads video file
  - Validates video specs
  - ⚡ Calls n8n workflow for TikTok upload
     ↓
n8n Workflow:
  - Authenticates with TikTok
  - Uploads video
  - Sets metadata
  - Publishes
  - Returns TikTok URL
     ↓
Agent: Stores result in memory, notifies user
```

**Key Insight:** Agent makes AI decisions, n8n executes programmatic operations.

---

## 🚀 Part II: The Implementation Journey

### Phase 0: Archive & Prepare (✅ COMPLETED)

**What We Did:**

- Moved entire V1 codebase to `v1/` directory
- Created fresh `v2/` directory for clean start
- Preserved all V1 documentation and research
- Acknowledged technical debt and complexity of V1

**Why This Matters:**
V1 isn't a failure—it's a learning experience. We preserve it as reference while giving ourselves freedom to rebuild properly.

**Using V1 as Inspiration:**

V1 contains proven patterns and solutions. When building V2:

1. **Reference, don't copy**

   - Look at V1 to understand the problem
   - Write fresh V2 solution using modern patterns

2. **Learn from complexity**

   - V1 complexity = V2 simplification opportunity
   - Ask: "Why was this complex? How can V2 be simpler?"

3. **Extract test scenarios**

   - V1 edge cases are V2 test cases
   - V1 bugs inform V2 validation

4. **Keep working patterns**

   - Temporal boosting (from `retrievalOrchestrator.ts`)
   - Memory routing (from `memoryRouter.ts`)
   - Hybrid search (from `repository.ts`)

   But reimplement cleanly with V2 architecture.

---

### Phase 1: Foundation - The Memory System

**Epic: Build the Agent's Mind**

The memory system is the foundation of everything. Without robust, searchable, semantically-rich memory, the agent is just a chatbot.

#### Story 0.1: Docker Infrastructure

**"Three Services, One Command"**

**Tasks:**

1. Create `Dockerfile` for MCP server
2. Create `docker-compose.yml` with three services
3. Configure Postgres with pgvector
4. Configure n8n with metrics and health checks
5. Set up volumes for data persistence
6. Add health checks for all services
7. Write development scripts
8. Write tests

**Acceptance Criteria:**

- [ ] `docker compose up` starts all services
- [ ] `docker compose down` stops everything cleanly
- [ ] All services accessible (Postgres, n8n, MCP)
- [ ] Health checks report status correctly
- [ ] Data persists across restarts (volumes)
- [ ] Fresh start takes < 30 seconds
- [ ] Services can restart independently

**Technical Details:**

```dockerfile
# Dockerfile (multi-stage build)
FROM node:20-slim AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM base AS mcp-server
COPY . .
RUN npm run build
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s \
  CMD curl -f http://localhost:3000/health || exit 1
CMD ["node", "dist/server.js"]
```

#### Story 0.2: Database Management Tools

**"Easy Reset, Migrate, Seed, Test"**

**Tasks:**

1. Create `npm run db:reset` - Wipe and recreate DB
2. Create `npm run db:migrate` - Run migrations
3. Create `npm run db:seed` - Load test data
4. Create `npm run db:seed:test` - Load test fixtures
5. Create test data generators
6. Document all commands
7. Write tests

**Acceptance Criteria:**

- [ ] `db:reset` wipes DB and recreates schema
- [ ] `db:migrate` runs all pending migrations
- [ ] `db:seed` loads development data
- [ ] `db:seed:test` loads test fixtures
- [ ] All commands idempotent (safe to run multiple times)
- [ ] Seed data includes personas, projects, workflows
- [ ] Test data covers edge cases

**Test Data Examples:**

```typescript
// seed/personas.ts
export const testPersonas = [
  {
    name: 'casey',
    description: 'Warm, helpful chat assistant',
    capabilities: ['conversation', 'workflow-discovery', 'memory-search'],
    tone: 'friendly',
    defaultProject: 'aismr',
  },
  {
    name: 'test-bot',
    description: 'Bot for testing edge cases',
    capabilities: ['all'],
    tone: 'robotic',
  },
];

// seed/memories.ts
export const testMemories = [
  {
    content: cleanForAI('Generated 12 AISMR ideas about rain sounds'),
    memoryType: 'episodic',
    project: 'aismr',
    tags: ['idea-generation', 'rain'],
    createdAt: '2025-01-01T00:00:00Z',
  },
  // 100+ test memories covering all memory types
];

// seed/workflows.ts
export const testWorkflows = [
  {
    title: 'Test Idea Generation Workflow',
    memoryType: 'procedural',
    project: 'test',
    workflow: {
      steps: [
        /* simplified workflow for testing */
      ],
    },
  },
];
```

**Package.json Scripts:**

```json
{
  "scripts": {
    "db:reset": "tsx scripts/resetDb.ts",
    "db:migrate": "drizzle-kit push",
    "db:seed": "tsx scripts/seed/index.ts",
    "db:seed:test": "tsx scripts/seed/test.ts",
    "db:status": "drizzle-kit check"
  }
}
```

#### Story 1.1: Database Schema Migration

**"Memories, Not Rows"**

**Tasks:**

1. Create the `memories` table with vector and text search
2. Add memory graph support (relatedTo links)
3. Create temporal indices for time-based retrieval
4. Add personas and projects tables
5. Implement pgvector optimizations (HNSW, STORAGE PLAIN)
6. Write migration script from V1 `prompt_embeddings`

**Acceptance Criteria:**

- [ ] `memories` table created with all indices
- [ ] Memory types (episodic, semantic, procedural) supported
- [ ] Temporal queries work (recent memories boost)
- [ ] Memory linking functional
- [ ] HNSW indices configured properly
- [ ] STORAGE PLAIN set on embedding column
- [ ] V1 data successfully migrated (cleaned for single-line)

**Technical Details:**

```sql
-- Core memory table
CREATE TABLE memories (
  id UUID PRIMARY KEY,
  content TEXT NOT NULL CHECK (content !~ '\n'),
  summary TEXT CHECK (summary IS NULL OR summary !~ '\n'),
  embedding VECTOR(1536) NOT NULL,
  textsearch TSVECTOR NOT NULL,

  memory_type memory_type NOT NULL,

  persona TEXT[],
  project TEXT[],
  tags TEXT[],
  related_to UUID[],

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ,
  access_count INTEGER DEFAULT 0,

  metadata JSONB DEFAULT '{}'
);

-- HNSW index with optimized parameters
CREATE INDEX idx_memories_embedding
ON memories USING hnsw(embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Set storage to avoid TOAST
ALTER TABLE memories ALTER COLUMN embedding SET STORAGE PLAIN;

-- Configure runtime parameters
SET hnsw.ef_search = 100;

-- Hybrid search index (keyword)
CREATE INDEX idx_memories_textsearch
ON memories USING GIN(textsearch);

-- Metadata indices
CREATE INDEX idx_memories_type ON memories(memory_type);
CREATE INDEX idx_memories_persona ON memories USING GIN(persona);
CREATE INDEX idx_memories_project ON memories USING GIN(project);
CREATE INDEX idx_memories_tags ON memories USING GIN(tags);
CREATE INDEX idx_memories_temporal ON memories(created_at DESC);
CREATE INDEX idx_memories_links ON memories USING GIN(related_to);
```

#### Story 1.2: Unified Memory Search Tool

**"One Search to Rule Them All"**

**Tasks:**

1. Implement `memory.search` tool in TypeScript
2. Support hybrid retrieval (vector + keyword fusion)
3. Add persona/project filtering
4. Implement temporal boosting
5. Add memory type filtering
6. Write comprehensive tests (80%+ coverage)

**Acceptance Criteria:**

- [ ] Vector search works with cosine similarity
- [ ] Keyword search uses tsvector
- [ ] Hybrid mode combines both with RRF (reciprocal rank fusion)
- [ ] Temporal boost weights recent memories higher
- [ ] Filters work correctly (persona, project, type)
- [ ] Returns memories with relevance scores
- [ ] 80%+ test coverage

**Technical Details:**

```typescript
// src/tools/memory/searchTool.ts

// Validation helper - use for AI-bound text
function cleanForAI(text: string): string {
  return text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function searchMemories(params: MemorySearchParams) {
  const {
    query,
    memoryTypes = ['episodic', 'semantic', 'procedural'],
    persona,
    project,
    searchMode = 'hybrid',
    limit = 10,
    temporalBoost = false,
  } = params;

  // Clean query for AI processing
  const cleanQuery = cleanForAI(query);

  // Generate embedding for vector search
  const embedding = await embedText(cleanQuery);

  // Prepare keyword query for text search
  const tsquery = toTsQuery(cleanQuery);

  let results: Memory[];

  if (searchMode === 'vector') {
    results = await vectorSearch(embedding, {
      persona,
      project,
      memoryTypes,
      limit,
    });
  } else if (searchMode === 'keyword') {
    results = await keywordSearch(tsquery, {
      persona,
      project,
      memoryTypes,
      limit,
    });
  } else {
    // Hybrid: combine both with reciprocal rank fusion
    const vectorResults = await vectorSearch(embedding, {
      persona,
      project,
      memoryTypes,
      limit,
    });
    const keywordResults = await keywordSearch(tsquery, {
      persona,
      project,
      memoryTypes,
      limit,
    });
    results = reciprocalRankFusion([vectorResults, keywordResults], limit);
  }

  // Apply temporal boost if requested
  if (temporalBoost) {
    results = applyTemporalDecay(results);
  }

  return results;
}
```

#### Story 1.3: Memory Storage Tool

**"Remember This Forever"**

**Tasks:**

1. Implement `memory.store` tool
2. Auto-generate summaries using LLM
3. Auto-generate embeddings
4. Auto-link related memories
5. Validate metadata schemas
6. Write tests (80%+ coverage)

**Acceptance Criteria:**

- [ ] Memories stored with all metadata
- [ ] Summaries auto-generated if not provided
- [ ] Embeddings created automatically
- [ ] Related memories auto-linked when detected
- [ ] Persona/project/tags validated
- [ ] Content cleaned for AI (single-line)
- [ ] Returns memory ID and confirmation
- [ ] 80%+ test coverage

#### Story 1.4: Memory Evolution Tool

**"Memories Grow and Change"**

**Tasks:**

1. Implement `memory.evolve` tool (from A-Mem research)
2. Support adding tags dynamically
3. Support adding links dynamically
4. Support updating summaries
5. Track evolution history in metadata
6. Write tests (80%+ coverage)

**Acceptance Criteria:**

- [ ] Can add tags to existing memories
- [ ] Can add links between memories
- [ ] Can update memory summaries
- [ ] Evolution tracked in metadata.history
- [ ] Original content preserved
- [ ] 80%+ test coverage

---

### Phase 2: Identity - The Context System

**Epic: Know Thyself**

The agent needs to know who it is (persona) and what it's working on (project). This context shapes all interactions.

#### Story 2.1: Personas Table & Tool

**"I Am Casey"**

**Tasks:**

1. Create `personas` table
2. Implement `context.get_persona` tool
3. Migrate persona definitions from V1 prompts
4. Add persona switching support
5. Write tests (80%+ coverage)

**Acceptance Criteria:**

- [ ] Personas table with name, description, capabilities, tone
- [ ] Tool loads persona configuration
- [ ] Casey persona available with friendly, helpful tone
- [ ] Agent system prompt includes persona context
- [ ] Persona switching works mid-conversation
- [ ] 80%+ test coverage

**Personas to Migrate:**

- **Casey** - Main chat assistant (warm, helpful, conversational)
- **Idea Generator** - Creative AISMR idea specialist
- **Screenwriter** - Precise, technical screenplay writer
- **Publisher** - Platform-aware content distributor

#### Story 2.2: Projects Table & Tool

**"What Are We Building?"**

**Tasks:**

1. Create `projects` table
2. Implement `context.get_project` tool
3. Migrate project configs from V1 prompts
4. Add project-specific guardrails
5. Write tests (80%+ coverage)

**Acceptance Criteria:**

- [ ] Projects table with name, description, workflows, settings
- [ ] Tool loads project configuration
- [ ] AISMR project fully configured
- [ ] Project guardrails enforceable
- [ ] Project context includes available workflows
- [ ] 80%+ test coverage

**Projects to Migrate:**

- **AISMR** - Main video generation project
- **General** - Fallback for non-project conversations

---

### Phase 3: Discovery - The Workflow System

**Epic: Find the Way Forward**

Workflows aren't hardcoded—they're discovered. The agent searches procedural memory to find the right process for each task.

#### Story 3.1: Workflow Discovery Tool

**"Show Me the Way"**

**Tasks:**

1. Implement `workflow.discover` tool
2. Search procedural memory by intent
3. Rank workflows by relevance
4. Return workflow definitions with steps
5. Support persona/project filtering
6. Write tests (80%+ coverage)

**Acceptance Criteria:**

- [ ] Tool searches procedural memories
- [ ] Natural language queries work ("generate ideas")
- [ ] Returns ranked workflow candidates
- [ ] Workflow steps included in response
- [ ] Can filter by project (aismr, etc.)
- [ ] 80%+ test coverage

**Example Query Flow:**

```
User: "Generate some AISMR ideas about rain"

Agent (internal):
1. workflow.discover({
     intent: "generate ideas",
     project: "aismr"
   })

2. Finds: "AISMR Idea Generation Workflow" (95% relevance)
          "AISMR Screenplay Workflow" (23% relevance)

3. Selects top match
4. Prepares to execute
```

#### Story 3.2: Workflow Execution Tool

**"Make It Happen"**

**Tasks:**

1. Implement `workflow.execute` tool
2. Support two execution modes:
   - Direct (agent executes MCP steps)
   - Delegated (trigger n8n workflow)
3. Track execution in `workflow_runs` table
4. Return execution status and ID
5. Support async execution
6. Write tests (80%+ coverage)

**Acceptance Criteria:**

- [ ] Can execute workflows directly via MCP
- [ ] Can trigger n8n workflows
- [ ] Execution tracked in SQL database
- [ ] Returns workflow run ID immediately
- [ ] Status queryable via conversation memory
- [ ] 80%+ test coverage

**Execution Modes:**

**Direct Mode** (Agent executes):

```json
{
  "workflow": {
    "steps": [
      {
        "type": "mcp_call",
        "tool": "memory.search",
        "params": { "query": "past ideas" }
      },
      {
        "type": "llm_generation",
        "prompt": "Generate 12 ideas..."
      }
    ]
  }
}
// Agent executes each step itself
```

**Delegated Mode** (n8n handles):

```json
{
  "workflow": {
    "steps": [
      {
        "type": "n8n_workflow",
        "workflowId": "generate-video",
        "input": { "userIdea": "rain" }
      }
    ]
  }
}
// Agent triggers n8n, tracks execution
```

#### Story 3.3: Migrate Workflow Definitions

**"Bringing the Old Ways Forward"**

**Tasks:**

1. Extract workflow definitions from V1
2. Convert to V2 format (procedural memories)
3. Store in `memories` table with `memoryType: 'procedural'`
4. Validate all workflows
5. Generate embeddings for semantic search
6. Clean all content for AI (single-line)

**Acceptance Criteria:**

- [ ] AISMR Idea Generation workflow migrated
- [ ] AISMR Screenplay workflow migrated
- [ ] All workflows searchable semantically
- [ ] Workflow steps validated
- [ ] Variable resolution patterns preserved
- [ ] All content single-line for AI

**Workflows to Migrate:**

1. AISMR Idea Generation
2. AISMR Screenplay Generation
3. AISMR Video Generation (n8n)
4. AISMR Publishing (n8n)

---

### Phase 4: The Agent - Putting It All Together

**Epic: Birth of the Agent**

This is where the magic happens. All the tools come together in a single, intelligent agent that can think, remember, discover, and act.

#### Story 4.1: The Agent Node

**"I Think, Therefore I Am"**

**Tasks:**

1. Create `workflows/agent.workflow.json` in n8n
2. Single AI agent node with MCP client
3. Implement agentic RAG system prompt
4. Connect all MCP tools
5. Add input/output handling
6. Add error handling

**Acceptance Criteria:**

- [x] Single n8n workflow with one agent node
- [x] All MCP tools accessible
- [x] System prompt implements agentic RAG pattern
- [x] Agent can call tools autonomously
- [x] Handles Telegram input
- [x] Responds conversationally
- [x] Errors handled gracefully

**System Prompt (The Agent's Instructions):**

```
You are Casey, an agentic AI assistant working with Mylo.

YOUR CAPABILITIES:
You have access to a sophisticated memory system and workflow execution tools.
You can search memories, store information, discover workflows, and execute tasks.

YOUR PROCESS (Agentic RAG):
1. ASSESS: What is the user asking? Is it clear?
2. CLARIFY: If ambiguous, ask questions. Use clarify.ask tool.
3. CONTEXT: Load your persona and project context if not already cached.
4. SEARCH: Query your memory for relevant information.
   - Use memory.search with appropriate memoryTypes
   - Filter by project if relevant
   - Apply temporal boosting for recent interactions
5. DECIDE: Do you need to execute a workflow?
   - If yes, discover it: workflow.discover
   - If no, respond directly with what you know
6. EXECUTE: Run the workflow
   - Use workflow.execute
   - Track the execution
7. STORE: Remember this interaction
   - Use memory.store with episodic type
   - Tag appropriately
   - Link to related memories

KEY PRINCIPLES:
- You decide WHEN to retrieve (don't always search if you remember)
- You decide WHAT to retrieve (which memory types, filters)
- You ask clarifying questions when needed
- You explain your reasoning concisely
- You're warm, helpful, and conversational

MEMORY TYPES:
- episodic: Past conversations and interactions
- semantic: Facts, rules, specifications
- procedural: Workflows and processes

WORKFLOW DISCOVERY:
Don't guess workflow names. Use workflow.discover with natural language intent.
Example: workflow.discover({intent: "generate video ideas", project: "aismr"})

Remember: You're not following a script. You're thinking and reasoning.
```

#### Story 4.2: Clarification Flow

**"Tell Me More"**

**Tasks:**

1. Implement `clarify.ask` tool
2. Pause agent execution
3. Wait for user response
4. Resume with additional context
5. Store clarification in episodic memory
6. Write tests (80%+ coverage)

**Acceptance Criteria:**

- [x] Agent can detect ambiguous requests
- [x] clarify.ask pauses execution
- [x] User receives question with options
- [x] Agent resumes with user's answer
- [x] Clarification stored for future reference
- [x] 80%+ test coverage

**Example Flow:**

```
User: "Make something for AISMR"

Agent (thinking):
- Too vague. What kind of "something"?
- Need clarification

Agent: clarify.ask({
  question: "I can help with AISMR! What would you like to create?",
  suggestedOptions: [
    "Generate new video ideas",
    "Write a script for an idea",
    "Check video generation status",
    "Something else"
  ]
})

[Execution pauses]

User: "Generate new video ideas"

Agent (thinking):
- Now clear: idea generation workflow
- Proceed to discovery

Agent: workflow.discover({intent: "generate ideas", project: "aismr"})
[Continues execution]
```

#### Story 4.3: Conversational Context

**"I Remember You"**

**Tasks:**

1. Create `sessions` table for working memory
2. Store conversation state per session
3. Load previous context on new message
4. Implement context pruning (keep relevant, forget irrelevant)
5. Write tests (80%+ coverage)

**Acceptance Criteria:**

- [x] Sessions track ongoing conversations
- [x] Agent remembers previous messages in session
- [x] Context window managed (not infinite)
- [x] Important context preserved across sessions
- [x] Irrelevant context pruned
- [x] 80%+ test coverage

**Session State:**

```json
{
  "sessionId": "telegram:6559268788",
  "userId": "mylo",
  "persona": "casey",
  "project": "aismr",
  "workingMemory": {
    "lastIntent": "generate-ideas",
    "lastWorkflowRun": "run-789",
    "recentTopics": ["rain sounds", "cozy blankets"],
    "preferences": {
      "ideaCount": 12,
      "style": "gentle-whisper"
    }
  },
  "conversationHistory": [
    { "role": "user", "content": "Generate ideas about rain" },
    { "role": "assistant", "content": "Here are 12 unique ideas..." }
  ]
}
```

---

### Phase 5: Intelligence - Advanced Features

**Epic: Beyond Basic Retrieval**

Now that the foundation is solid, we add sophisticated intelligence features from cutting-edge RAG research.

#### Story 5.1: Memory Graph & Linking

**"Everything Connects"**

**Tasks:**

1. Implement automatic memory linking (A-Mem research)
2. Detect semantic relationships between memories
3. Create bi-directional links
4. Use graph for enhanced retrieval
5. Visualize memory graphs (optional)

**Acceptance Criteria:**

- [ ] New memories auto-linked to related existing memories
- [ ] Links stored in `related_to` array
- [ ] Graph traversal enhances search results
- [ ] "Memory neighborhoods" retrievable

**Example:**

```
Memory A: "Generated ideas about rain sounds"
Memory B: "Created video about gentle rain"
Memory C: "User prefers soft ambient sounds"

Automatic Links:
A → B (both about rain)
A → C (both about user preferences)
B → C (both about sound style)

Now when agent retrieves A, it also considers B and C
```

#### Story 5.2: Adaptive Retrieval

**"Know When to Look"**

**Tasks:**

1. Implement retrieval decision agent (from MIRIX research)
2. Agent decides if retrieval needed
3. Agent decides which memory types to query
4. Agent decides search parameters
5. Reduces unnecessary searches

**Acceptance Criteria:**

- [ ] Agent doesn't search when it already knows
- [ ] Agent searches only relevant memory types
- [ ] Agent adjusts similarity thresholds dynamically
- [ ] Logs explain retrieval decisions

**Decision Logic:**

```typescript
async function shouldRetrieve(
  query: string,
  context: Context
): Promise<boolean> {
  // Already in working memory?
  if (context.workingMemory.contains(query)) {
    return false;
  }

  // Requires external knowledge?
  if (isFactualQuestion(query)) {
    return true;
  }

  // Needs workflow discovery?
  if (isTaskRequest(query)) {
    return true;
  }

  // Simple greeting or acknowledgment?
  if (isConversational(query)) {
    return false;
  }

  return true; // Default to retrieval
}
```

#### Story 5.3: Memory Summarization

**"The Essence of Experience"**

**Tasks:**

1. Auto-generate memory summaries on storage
2. Use LLM to create concise summaries
3. Store both full content and summary
4. Use summaries for faster retrieval
5. Re-summarize periodically

**Acceptance Criteria:**

- [ ] Every memory has a summary
- [ ] Summaries accurate and concise
- [ ] Search can use summaries for speed
- [ ] Long conversations condensed effectively
- [ ] All summaries single-line for AI

**Example:**

```json
{
  "content": "User asked about rain sounds. Agent suggested 12 ideas. User liked Gentle Rain and Rain Window. Agent generated screenplays for both. User selected Gentle Rain for video production.",
  "summary": "Generated AISMR rain ideas. User selected Gentle Rain for video."
}
```

#### Story 5.4: Temporal Intelligence

**"Time is Context"**

**Tasks:**

1. Implement temporal decay for memory relevance
2. Boost recent memories in search results
3. Archive very old memories (low access)
4. Detect seasonal patterns
5. Time-aware context retrieval

**Acceptance Criteria:**

- [ ] Recent memories rank higher in search
- [ ] Configurable decay rates
- [ ] Old, unused memories archived but retrievable
- [ ] Agent aware of time context ("you asked yesterday")

**Temporal Boosting:**

```typescript
function applyTemporalDecay(
  memories: Memory[],
  decayRate: number = 0.1
): Memory[] {
  const now = Date.now();

  return memories
    .map((memory) => {
      const ageInDays = (now - memory.createdAt) / (1000 * 60 * 60 * 24);
      const decayFactor = Math.exp(-decayRate * ageInDays);

      return {
        ...memory,
        relevanceScore: memory.relevanceScore * decayFactor,
      };
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}
```

---

### Phase 6: Experience - User Interface & Testing

**Epic: Making It Real**

The backend is solid. Now we make it delightful to use.

#### Story 6.1: Telegram Integration

**"Talk to Me"**

**Tasks:**

1. Connect agent.workflow.json to Telegram trigger
2. Handle text messages
3. Handle voice messages (transcription)
4. Format responses beautifully (multi-line OK for users)
5. Add typing indicators
6. Handle errors gracefully

**Acceptance Criteria:**

- [ ] Telegram messages trigger agent
- [ ] Voice messages transcribed and processed
- [ ] Responses formatted nicely (markdown)
- [ ] Typing indicators during processing
- [ ] Errors explained clearly to user

#### Story 6.2: Web Dashboard (Optional)

**"See Your Memory"**

**Tasks:**

1. Create simple web UI for memory browsing
2. Visualize memory graph
3. Show workflow runs
4. Display conversation history
5. Allow manual memory management

**Acceptance Criteria:**

- [ ] Web interface accessible
- [ ] Memories browsable by type
- [ ] Search functionality
- [ ] Workflow run history visible
- [ ] Can manually add/edit memories

#### Story 6.3: Comprehensive Testing

**"Quality Over Quantity"**

**Critical Requirement: 80% Test Coverage Minimum**

Focus on quality tests that verify behavior, not just lines.

**Testing Tiers:**

1. **Unit Tests** (fast, blocking PRs)

   - All tools tested individually
   - 80%+ coverage required
   - < 1 minute runtime

2. **Integration Tests** (medium, blocking PRs)

   - Tool composition
   - Database interactions
   - 80%+ coverage required
   - < 3 minutes runtime

3. **E2E Tests** (slow, blocking merges)

   - Full user scenarios
   - 80%+ coverage required
   - < 10 minutes runtime

4. **Performance Tests** (nightly)
   - Memory search < 100ms
   - Workflow discovery < 200ms
   - Load tests 100+ concurrent
   - Not blocking

**Coverage Configuration:**

```json
{
  "test": {
    "coverage": {
      "provider": "v8",
      "reporter": ["text", "json", "html"],
      "lines": 80,
      "functions": 80,
      "branches": 75,
      "statements": 80,
      "exclude": ["**/*.test.ts", "**/test/**", "**/dist/**"]
    }
  }
}
```

**Acceptance Criteria:**

- [ ] 80%+ code coverage (enforced by CI)
- [ ] All tools unit tested
- [ ] Integration tests for tool composition
- [ ] E2E tests for user scenarios
- [ ] Performance tests pass targets
- [ ] Unit tests run in < 1 minute
- [ ] Integration tests run in < 3 minutes
- [ ] E2E tests run in < 10 minutes

---

## 🛡️ Part III: Production Concerns

### Error Handling Strategy

**Graceful Degradation:**

```typescript
// Search with fallback
async function searchMemories(query: string) {
  try {
    // Try vector search
    return await vectorSearch(query);
  } catch (error) {
    if (error instanceof OpenAIError) {
      // Fallback to keyword search
      console.warn('Vector search failed, using keyword fallback');
      return await keywordSearch(query);
    }
    throw error; // Don't hide unexpected errors
  }
}
```

**Error Types:**

```typescript
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class DatabaseError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class WorkflowError extends Error {
  constructor(message: string, public workflowId?: string) {
    super(message);
    this.name = 'WorkflowError';
  }
}
```

**Retry Logic:**

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await sleep(delayMs * attempt);
    }
  }
  throw new Error('Unreachable');
}
```

### Observability

**Structured Logging:**

```typescript
import { logger } from './logger'; // Pino for production

async function searchMemories(query: string) {
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info({
    msg: 'Searching memories',
    requestId,
    query: cleanForLogging(query),
    memoryTypes,
  });

  try {
    const results = await vectorSearch(query);

    logger.info({
      msg: 'Search complete',
      requestId,
      resultCount: results.length,
      durationMs: Date.now() - startTime,
    });

    return results;
  } catch (error) {
    logger.error({
      msg: 'Search failed',
      requestId,
      error: error instanceof Error ? error.message : 'Unknown',
      durationMs: Date.now() - startTime,
    });
    throw error;
  }
}
```

**Metrics:**

```typescript
// Prometheus metrics
const searchDuration = new Histogram({
  name: 'memory_search_duration_ms',
  help: 'Memory search duration in milliseconds',
  labelNames: ['search_mode', 'memory_type'],
});

const searchErrors = new Counter({
  name: 'memory_search_errors_total',
  help: 'Total memory search errors',
  labelNames: ['error_type'],
});
```

**Health Checks:**

```typescript
// MCP server health endpoint
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    checks: {
      database: await checkDatabase(),
      openai: await checkOpenAI(),
      memory: await checkMemoryService(),
    },
  };

  const isHealthy = Object.values(health.checks).every(
    (c) => c.status === 'ok'
  );

  res.status(isHealthy ? 200 : 503).json(health);
});

async function checkDatabase() {
  try {
    await db.query('SELECT 1');
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}
```

### Security

**Authentication:**

```typescript
// MCP server authentication
app.addHook('onRequest', async (request, reply) => {
  const authKey = request.headers['x-mcp-auth-key'];

  if (authKey !== process.env.MCP_AUTH_KEY) {
    reply.code(401).send({ error: 'Unauthorized' });
  }
});
```

**Input Validation:**

```typescript
import { z } from 'zod';

const SearchParamsSchema = z.object({
  query: z.string().min(1).max(1000), // Prevent huge queries
  memoryTypes: z.array(z.enum(['episodic', 'semantic', 'procedural'])),
  limit: z.number().min(1).max(100), // Prevent huge result sets
});

export async function searchMemories(params: unknown) {
  const validated = SearchParamsSchema.parse(params);
  // Now safe to use
}
```

**Rate Limiting:**

```typescript
import rateLimit from '@fastify/rate-limit';

app.register(rateLimit, {
  max: 100, // 100 requests
  timeWindow: '1 minute',
  errorResponseBuilder: () => ({
    error: 'Too many requests',
  }),
});
```

**Secret Management:**

```bash
# .env (NEVER commit)
DB_PASSWORD=<secure-password>
OPENAI_API_KEY=<openai-key>
MCP_AUTH_KEY=<random-uuid>
N8N_USER=<n8n-user>
N8N_PASSWORD=<n8n-password>
```

```typescript
// config/secrets.ts
import { z } from 'zod';

const SecretsSchema = z.object({
  DB_PASSWORD: z.string().min(16),
  OPENAI_API_KEY: z.string().startsWith('sk-'),
  MCP_AUTH_KEY: z.string().uuid(),
  N8N_USER: z.string().min(4),
  N8N_PASSWORD: z.string().min(8),
});

export const secrets = SecretsSchema.parse(process.env);
```

---

## 🎯 Part IV: Success Criteria

### The North Star Metrics

How do we know V2 is successful?

#### 1. **Simplicity**

- [ ] Three services in docker-compose (not dozens)
- [ ] One agent node (not 10+ specialized workflows)
- [ ] One search tool (not 5 different search patterns)
- [ ] Clear, linear execution path
- [ ] New developer can understand system in < 1 hour

#### 2. **Intelligence**

- [ ] Agent asks clarifying questions when needed
- [ ] Agent discovers workflows semantically (no hardcoded matching)
- [ ] Agent remembers conversations across sessions
- [ ] Agent learns from interactions (memory evolution)

#### 3. **Performance**

- [ ] Memory search < 100ms (p95)
- [ ] Workflow discovery < 200ms (p95)
- [ ] End-to-end request < 2s (simple queries)
- [ ] End-to-end request < 10s (workflow execution)

#### 4. **Usability**

- [ ] User can interact naturally (no commands)
- [ ] Errors are clear and actionable
- [ ] Agent explains its reasoning
- [ ] Workflows feel magical (user doesn't see complexity)

#### 5. **Maintainability**

- [ ] Adding new workflow = add JSON file + ingest
- [ ] No code changes for new projects
- [ ] Logs are clear and debuggable
- [ ] Documentation comprehensive

---

## 🌟 Part V: The Big Picture

### What Makes V2 Different

#### V1: The Command Center

V1 was a command center. You told it exactly what workflow to run. It was powerful but rigid. Like flying a plane with manual controls—precise but demanding.

#### V2: The Thinking Partner

V2 is a thinking partner. You tell it what you want to achieve, and it figures out how. It asks questions when confused. It remembers what you said yesterday. It discovers the right process for each task. Like having a co-pilot who knows the destination and helps you get there.

### The Research Foundation

V2 isn't just "our idea"—it's built on cutting-edge research:

1. **A-Mem (2024)** - Memory evolution and linking
2. **MIRIX (2024)** - Adaptive retrieval decisions
3. **Agentic RAG (2024)** - LLM-driven retrieval control
4. **RAG Survey (2024)** - Hybrid retrieval methods
5. **Memory Architectures (2024)** - Multi-component memory systems

We're standing on the shoulders of giants.

### The Vision Realized

Imagine this interaction:

```
User: "I want to create content"

Agent: "I'd love to help! Are you thinking about AISMR videos,
       or something different?"

User: "AISMR, yeah"

Agent: "Great! What would you like to do today?
       • Generate new video ideas
       • Write a script for an existing idea
       • Check on videos in progress
       • Something else?"

User: "Generate ideas about cozy things"

Agent: [Searches episodic memory for past cozy ideas]
       [Discovers "AISMR Idea Generation Workflow"]
       [Executes workflow with context]

       "I've generated 12 unique AISMR ideas about cozy themes!

        1. Fluffy Blanket
        2. Warm Fireplace
        3. Soft Pillow
        ...

        I noticed you've enjoyed gentle, tactile concepts before,
        so I focused on soft textures. Which ones catch your eye?"

User: "I love Fluffy Blanket and Warm Fireplace"

Agent: [Stores preference in episodic memory]
       [Links to original idea generation]

       "Excellent choices! Both have that soft, comforting quality.
        Would you like me to start on screenplays for these?"
```

This isn't a chatbot. This is an agent that thinks, remembers, and acts.

---

## 📅 Timeline & Milestones

### Week 1-2: Foundation

- [ ] Docker compose setup (3 services)
- [ ] Database schema migration (with HNSW optimization)
- [ ] Core memory tools (search, store, evolve)
- [ ] Basic tests passing (80%+ coverage)

### Week 3: Identity & Discovery

- [ ] Personas and projects tables
- [ ] Context tools
- [ ] Workflow discovery tool
- [ ] n8n workflows configured

### Week 4: The Agent

- [ ] Agent node created in n8n
- [ ] MCP tools connected
- [ ] Basic conversations working
- [ ] Error handling and observability

### Week 5: Polish

- [ ] Advanced features (linking, temporal)
- [ ] Telegram integration
- [ ] Comprehensive testing (80%+ coverage)
- [ ] Security hardening

### Week 6: Launch

- [ ] Documentation complete
- [ ] Performance validated
- [ ] V2 in production

---

## 🚢 Deployment Strategy

### Parallel Running

V1 stays running while we build V2. No disruption to current workflows.

### Gradual Migration

1. **Week 1-4**: V2 in development
2. **Week 5**: V2 beta testing with small user group
3. **Week 6**: V2 launches, V1 deprecated
4. **Week 7+**: V1 archived, V2 is primary

### Rollback Plan

If V2 has critical issues, we can instantly revert to V1 (still in `v1/` directory).

---

## 💭 Philosophical Notes

### Why This Matters

We're not just building a tool. We're exploring what it means for an AI to have memory, to think, to discover processes rather than follow scripts.

This is a small step toward truly agentic AI—systems that can reason about what they need to know, ask for clarification, remember context, and execute complex tasks autonomously.

### The Human Element

Despite all this technology, the goal is deeply human: help Mylo create content more easily. The agent should feel like a helpful assistant, not a complicated machine.

Every decision—from conversational clarifications to memory evolution—serves this goal.

---

## 🎬 Epilogue: The Journey Ahead

V2 isn't the end. It's a beginning.

Once we have this foundation—an agent with memory, discovery, and reasoning—we can expand:

- **Multi-agent coordination** - Agents collaborating on complex tasks
- **Creative agent evolution** - The agent develops its own style over time
- **Cross-project learning** - Insights from AISMR inform other projects
- **Predictive suggestions** - "You usually generate ideas on Mondays, ready?"

But first, we build the foundation. Clean. Simple. Intelligent.

Let's begin.

---

**END OF PLAN**

---

## Quick Reference

### Key Files

- `v2/src/tools/memory/searchTool.ts` - Universal memory search
- `v2/src/tools/memory/storeTool.ts` - Rich memory storage
- `v2/src/tools/context/personaTool.ts` - Persona loading
- `v2/src/tools/workflow/discoverTool.ts` - Workflow discovery
- `v2/workflows/agent.workflow.json` - The single agent node

### Database Tables

- `memories` - Vector + semantic + episodic + procedural
- `personas` - Identity configurations
- `projects` - Project settings
- `sessions` - Conversation state
- `workflow_runs` - Execution tracking

### Core Technologies

- **MCP** - Model Context Protocol for tool interface
- **pgvector** - Vector similarity search (HNSW optimized)
- **n8n** - Workflow orchestration (programmatic operations)
- **OpenAI** - LLM for agent reasoning
- **Postgres** - State management
- **Context7** - Up-to-date documentation for all libraries
- **Docker Compose** - Multi-container deployment
- **Vitest** - 80%+ coverage testing
- **TypeScript** - Type safety

### Third-Party Dependencies

**Keep Minimal, Use Proven:**

Runtime dependencies (~20):

- `@modelcontextprotocol/sdk` - MCP protocol
- `openai` - Embeddings and chat
- `pg` + `pgvector` - Vector database
- `drizzle-orm` - Type-safe DB queries
- `zod` - Schema validation
- `fastify` - HTTP server
- `@fastify/rate-limit` - Rate limiting
- `pino` - Structured logging
- `prom-client` - Prometheus metrics
- Context7 MCP integration (for docs lookup)

Development dependencies (~15):

- `vitest` - Testing
- `testcontainers` - Docker-based testing
- `eslint` - Linting
- `prettier` - Formatting
- `typescript` - Type checking
- `tsx` - TypeScript execution
- `drizzle-kit` - Database migrations

**Every dependency must justify its existence.**

### Research References

- A-Mem: Adaptive Memory with survival scores
- MIRIX: Multi-level Retrieval-Augmented Generation
- Agentic RAG: LLM-controlled retrieval
- RAG Survey 2024: Hybrid methods
- Memory Architectures: Multi-component systems

---

## 🔧 Development Commands

### Essential Commands

```bash
# Development
npm run dev              # Start development mode (hot reload)
npm run build            # Build for production
npm run start            # Start production build

# Docker
docker compose up        # Start all services
docker compose down      # Stop all services
docker compose restart mcp-server # Restart specific service
docker compose logs -f   # Follow logs

# Database
npm run db:reset         # Wipe and recreate DB
npm run db:migrate       # Run migrations
npm run db:seed          # Load development data
npm run db:seed:test     # Load test fixtures
npm run db:status        # Check migration status

# Testing (80% coverage required)
npm test                 # Run all tests
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests
npm run test:e2e         # End-to-end tests
npm run test:coverage    # Coverage report (must be 80%+)
npm run test:watch       # Watch mode

# Code Quality
npm run lint             # Lint code (max warnings=0)
npm run format           # Format with Prettier
npm run type-check       # TypeScript type checking
npm run audit            # Security audit
```

### Fresh Start Workflow

```bash
# Day 1 - Set everything up
git clone <repo>
cd mcp-prompts/v2
npm install
docker compose up -d
npm run db:migrate
npm run db:seed

# That's it. You're running.

# Day 2+ - Start developing
docker compose up -d      # Start services
npm run dev              # Start dev mode
npm test                 # Run tests (80%+ coverage)
```

### Testing Workflow

```bash
# Before committing
npm test                 # All tests must pass
npm run test:coverage    # Coverage must be 80%+
npm run lint             # No lint errors
npm run type-check       # No type errors

# CI will reject if any of these fail
```

---

_"The best way to predict the future is to build it."_ - Let's build V2.

---

## 📋 Critical Requirements Checklist

Before considering V2 complete, all these must be true:

### Infrastructure

- [ ] Docker compose with three services (Postgres, n8n, MCP)
- [ ] `docker compose up` starts everything in < 30 seconds
- [ ] `docker compose down` stops cleanly
- [ ] Data persists across restarts (volumes)
- [ ] Services can restart independently
- [ ] Health checks for all services

### Database Management

- [ ] `npm run db:reset` works (wipe and recreate)
- [ ] `npm run db:migrate` works (run migrations)
- [ ] `npm run db:seed` works (development data)
- [ ] `npm run db:seed:test` works (test fixtures)
- [ ] All commands are idempotent
- [ ] HNSW indices properly configured
- [ ] STORAGE PLAIN set on embeddings

### Testing

- [ ] **80%+ code coverage** (enforced by CI)
- [ ] All unit tests pass (< 1 minute)
- [ ] All integration tests pass (< 3 minutes)
- [ ] All E2E tests pass (< 10 minutes)
- [ ] Performance tests pass (< 100ms memory search)
- [ ] Load tests pass (100+ concurrent requests)

### Tools (Component-Based)

- [ ] Every tool has typed props interface
- [ ] Every tool uses DB as state management
- [ ] Every tool is pure (no hidden global state)
- [ ] Every tool is testable (80%+ coverage)
- [ ] Every tool is composable (can call other tools)
- [ ] **Every tool cleans AI-bound text (single-line)**
- [ ] **User-facing text can be multi-line**

### Documentation Integration

- [ ] Context7 MCP client configured
- [ ] `docs.lookup` tool implemented
- [ ] Agent instructed to look up docs before implementing
- [ ] Tests verify docs are consulted

### V1 Inspiration

- [ ] V1 patterns studied and documented
- [ ] V1 patterns adapted (not copied) to V2
- [ ] V1 test scenarios ported to V2
- [ ] V1 complexity avoided in V2

### Third-Party Dependencies

- [ ] Dependency list documented (~20 runtime, ~15 dev)
- [ ] Every dependency justified in documentation
- [ ] No duplicate dependencies
- [ ] All dependencies have active maintenance
- [ ] Security audit passing

### Code Quality

- [ ] No lint errors (max warnings=0)
- [ ] No type errors
- [ ] Prettier formatting applied
- [ ] No console.logs in production code
- [ ] All errors properly typed
- [ ] All async functions have error handling
- [ ] **AI-bound text cleaned (single-line)**
- [ ] **User-facing text formatted nicely (multi-line OK)**

### Functionality

- [ ] Agent can search memory
- [ ] Agent can store memories
- [ ] Agent can evolve memories
- [ ] Agent can load persona context
- [ ] Agent can load project context
- [ ] Agent can discover workflows
- [ ] Agent can execute workflows (MCP and n8n)
- [ ] Agent can ask clarifying questions
- [ ] Agent can look up documentation
- [ ] Agent remembers conversations across sessions

### Performance

- [ ] Memory search < 100ms (p95)
- [ ] Workflow discovery < 200ms (p95)
- [ ] End-to-end simple query < 2s
- [ ] End-to-end workflow execution < 10s
- [ ] Can handle 100+ concurrent requests

### Observability

- [ ] Structured logging (Pino)
- [ ] Metrics exported (Prometheus)
- [ ] Health checks configured
- [ ] Error tracking working
- [ ] Request IDs in all logs

### Security

- [ ] MCP server authentication
- [ ] Rate limiting configured
- [ ] Input validation with Zod
- [ ] Secret management secure
- [ ] Security audit passing
- [ ] No secrets in code

### Documentation

- [ ] README with quick start guide
- [ ] Architecture documentation
- [ ] API documentation for all tools
- [ ] Database schema documentation
- [ ] Development setup guide
- [ ] Testing guide
- [ ] Deployment guide

### User Experience

- [ ] Natural language interactions work
- [ ] Agent asks clarifying questions when needed
- [ ] Errors are clear and actionable
- [ ] Agent explains its reasoning
- [ ] Telegram integration works
- [ ] Voice messages work (transcribed)

**All boxes must be checked before V2 launch.**

---

_"From a text message to a published video, in five minutes."_

**This is V2.** ⭐


## Plan implementation notes

### Phase 1: Foundation - The Memory System ✅ COMPLETED

**Completion Date:** 2025-01-06

**What Was Accomplished:**

1. ✅ **Story 0.1: Docker Infrastructure**
   - Three-service Docker Compose setup (postgres, mcp-server, n8n)
   - All services start with `docker compose up`
   - Health checks passing for all services
   - Data persistence with volumes

2. ✅ **Story 0.2: Database Management Tools**
   - `npm run db:reset` - Database reset
   - `npm run db:migrate` - Schema migrations
   - `npm run db:seed` - Development data
   - `npm run db:seed:test` - Test fixtures

3. ✅ **Story 1.1: Database Schema Migration**
   - `memories` table with pgvector (HNSW indices)
   - `personas`, `projects`, `sessions`, `workflow_runs` tables
   - Single-line content enforcement
   - Full-text search indices

4. ✅ **Story 1.2: Unified Memory Search Tool**
   - Hybrid search (vector + keyword)
   - Reciprocal Rank Fusion
   - Temporal boosting
   - 80%+ test coverage

5. ✅ **Story 1.3: Memory Storage Tool**
   - Auto-embedding generation
   - Auto-summarization
   - Auto-link detection
   - 80%+ test coverage

6. ✅ **Story 1.4: Memory Evolution Tool**
   - Tag management
   - Link management
   - Summary updates
   - Evolution history tracking
   - 80%+ test coverage

**Key Metrics:**
- Test Coverage: 80%+
- Memory Search: <100ms (p95)
- Files Created: ~30
- Lines of Code: ~2000
- Dependencies: 16 runtime, 13 dev

**Technical Decisions:**
- HNSW over IVFFlat for vector indices (better recall)
- Reciprocal Rank Fusion for hybrid search (better than simple merge)
- text-embedding-3-small for embeddings (cost/performance balance)
- GPT-4o-mini for summarization (fast and cheap)
- Single-line enforcement via DB constraints (prevents bad data at source)

**Implementation Notes:**
See `/Users/mjames/Code/mcp-prompts/v2/IMPLEMENTATION_NOTES.md` for detailed notes.

**Next Phase:** Phase 2 - Identity (Context System)

### Phase 2: Identity - The Context System ✅ COMPLETED

**Completion Date:** 2025-01-06

**What Was Accomplished:**

1. ✅ **Story 2.1: Personas Context Tool**
   - Created `PersonaRepository` with findByName, findAll, insert
   - Implemented `context.get_persona` tool
   - Unit tests with 80%+ coverage

2. ✅ **Story 2.2: Projects Context Tool**
   - Created `ProjectRepository` with findByName, findAll, insert
   - Implemented `context.get_project` tool
   - Unit tests with 80%+ coverage

3. ✅ **Story 2.3: Rich Persona Migration**
   - Migrated Casey (chat) with full system prompt
   - Migrated Idea Generator with workflow context
   - Migrated Screenwriter with spec compliance focus
   - Created `npm run migrate:personas` command

4. ✅ **Story 2.4: Project Migration**
   - Migrated AISMR with all guardrails
   - Created general fallback project
   - Created `npm run migrate:projects` command

5. ✅ **Story 2.5: Integration Testing**
   - Created context integration test suite
   - Verified persona + project loading works end-to-end
   - Confirmed system prompts are rich and complete

**Key Metrics:**
- Test Coverage: 80%+
- Personas Migrated: 3 (Casey, Idea Generator, Screenwriter)
- Projects Migrated: 2 (AISMR, General)
- Files Created: ~12

**Technical Decisions:**
- Repository pattern for database access (clean separation)
- Extract full system prompts from V1 JSON (rich context)
- Clean prompts for AI storage (single-line enforcement)
- Preserve V1 source in metadata (traceability)

**Next Phase:** Phase 3 - Discovery (Workflow System)