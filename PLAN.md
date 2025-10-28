# MCP Prompt Vector Server - Project Plan

## Overview

Build a self-hosted Model Context Protocol (MCP) server that stores n8n workflow prompts in a PostgreSQL database with pgvector for semantic search. The server will expose MCP tools via Cloudflare tunnel, enabling AI assistants to intelligently query and retrieve prompts based on persona, project, and semantic similarity.

---

## Current State Analysis

### What We Have

- **7 prompt files** in `/prompts/`:
  - Persona prompts: `persona-chat.md`, `persona-ideagenerator.md`, `persona-screenwriter.md`, `persona-captionhashtag.md`
  - Project prompts: `project-aismr.md`
  - Combination prompts: `ideagenerator-aismr.md`, `screenwriter-aismr.md`
- **SQL-based system**: Prompts currently converted to SQL inserts in `sql/prompts-inserts.sql`
- **Scripts**: `build-prompts-sql.js` and `update-dev-reset.js` for SQL generation
- **Naming convention**: `{persona}-{project}.md`, `persona-{name}.md`, `project-{name}.md`
- **Cloudflared setup**: Existing `cloudflared/` directory with webhook infrastructure

### What We Need

- Vector database to enable semantic prompt search
- MCP server with HTTP transport (Cloudflare tunnel)
- Ingestion pipeline to convert markdown prompts to embeddings
- MCP tools for querying prompts by persona, project, and semantic similarity
- Metadata extraction for persona/project tags

---

## Architecture

### Technology Stack

| Component            | Technology                      | Purpose                  |
| -------------------- | ------------------------------- | ------------------------ |
| **Runtime**          | Node.js 20+ (TypeScript)        | Server execution         |
| **MCP SDK**          | `@modelcontextprotocol/sdk`     | Protocol implementation  |
| **Database**         | PostgreSQL 16+                  | Prompt storage           |
| **Vector Extension** | pgvector 0.7.0+                 | Semantic search          |
| **ORM**              | Drizzle ORM                     | Type-safe DB queries     |
| **Embeddings**       | OpenAI `text-embedding-3-small` | 1536-dimensional vectors |
| **Transport**        | HTTP/SSE via Cloudflare tunnel  | Remote access            |
| **Chunking**         | llm-splitter                    | Smart text chunking      |

### Database Schema

```sql
-- Single database: mcp_prompts
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS prompt_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chunk_id TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL,              -- e.g., "prompts/persona-chat.md"
  chunk_text TEXT NOT NULL,              -- The actual content chunk
  granularity TEXT NOT NULL,             -- "document" or "recursive"
  embedding VECTOR(1536) NOT NULL,       -- OpenAI embedding
  metadata JSONB NOT NULL DEFAULT '{}',  -- { persona: [], project: [], type: "persona|project|combination" }
  checksum TEXT,                         -- File hash for change detection
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_prompt_embeddings_file_path
  ON prompt_embeddings(file_path);

CREATE INDEX IF NOT EXISTS idx_prompt_embeddings_metadata
  ON prompt_embeddings USING GIN(metadata);

CREATE INDEX IF NOT EXISTS idx_prompt_embeddings_vector
  ON prompt_embeddings USING ivfflat(embedding vector_cosine_ops)
  WITH (lists = 100);
```

### Metadata Schema

Extracted from filename and content:

```typescript
interface PromptMetadata {
  type: 'persona' | 'project' | 'combination';
  persona: string[]; // ["chat"] or ["ideagenerator", "aismr"]
  project: string[]; // ["aismr"]
  filename: string; // "persona-chat.md"
  section?: string; // For multi-section documents
}
```

**Examples:**

- `persona-chat.md` → `{ type: "persona", persona: ["chat"], project: [], ... }`
- `project-aismr.md` → `{ type: "project", persona: [], project: ["aismr"], ... }`
- `ideagenerator-aismr.md` → `{ type: "combination", persona: ["ideagenerator"], project: ["aismr"], ... }`

---

## Project Structure

```
/Users/mjames/Code/n8n/
├── mcp-prompts/                    # New MCP server directory
│   ├── server.ts                   # HTTP entry point
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env                        # Local config
│   ├── drizzle.config.ts
│   │
│   ├── src/
│   │   ├── config/
│   │   │   ├── index.ts            # Environment validation
│   │   │   ├── constants.ts        # Server name, version
│   │   │   └── defaults.ts         # Default values
│   │   │
│   │   ├── db/
│   │   │   ├── schema.ts           # Drizzle schema
│   │   │   ├── pool.ts             # Connection pool
│   │   │   ├── repository.ts       # Query functions
│   │   │   └── errors.ts           # Custom errors
│   │   │
│   │   ├── ingestion/
│   │   │   ├── ingest.ts           # Main ingestion orchestrator
│   │   │   ├── walker.ts           # File discovery
│   │   │   ├── chunker.ts          # Text chunking
│   │   │   ├── metadata.ts         # Filename parsing
│   │   │   ├── embedder.ts         # OpenAI embedding calls
│   │   │   └── fileProcessor.ts    # Content processing
│   │   │
│   │   ├── server/
│   │   │   ├── createMcpServer.ts  # MCP server setup
│   │   │   ├── httpHelpers.ts      # HTTP utilities
│   │   │   ├── schemas.ts          # Zod schemas
│   │   │   │
│   │   │   ├── tools/
│   │   │   │   ├── searchPromptsTool.ts      # Semantic search
│   │   │   │   ├── getPromptTool.ts          # Get by file path
│   │   │   │   ├── listPromptsTool.ts        # List all prompts
│   │   │   │   └── filterPromptsTool.ts      # Filter by persona/project
│   │   │   │
│   │   │   └── resources/
│   │   │       ├── promptsInfoResource.ts    # prompt://info
│   │   │       └── statusResource.ts         # status://health
│   │   │
│   │   └── types/
│   │       └── index.ts            # Shared TypeScript types
│   │
│   ├── scripts/
│   │   ├── runIngestion.ts         # CLI: ingest all prompts
│   │   ├── ingestChanged.ts        # CLI: incremental ingestion
│   │   ├── runMigrations.ts        # DB setup
│   │   └── testTool.ts             # Test tool invocation
│   │
│   ├── drizzle/
│   │   ├── 0000_init.sql           # Initial schema
│   │   └── meta/                   # Drizzle metadata
│   │
│   ├── cloudflared/
│   │   ├── config.prompts.yml      # Cloudflare tunnel config
│   │   └── credentials/
│   │       └── n8n-prompts.json    # Tunnel credentials
│   │
│   └── .gitignore
│
├── prompts/                        # Existing prompt files (source of truth)
│   ├── persona-chat.md
│   ├── persona-ideagenerator.md
│   ├── ...
│
└── cloudflared/                    # Existing cloudflared setup (reuse?)
```

---

## MCP Tools Design

### 1. `prompts.search` (Primary Tool)

**Purpose**: Semantic search across all prompts

**Input Schema**:

```typescript
{
  query: string;                    // Natural language query
  persona?: string;                 // Filter by persona (e.g., "chat")
  project?: string;                 // Filter by project (e.g., "aismr")
  limit?: number;                   // Max results (default: 5)
  minSimilarity?: number;           // Cosine similarity threshold (0-1)
}
```

**Output**:

```typescript
{
  results: Array<{
    filePath: string; // "prompts/persona-chat.md"
    chunkText: string; // The matching content
    similarity: number; // Cosine similarity score
    metadata: {
      type: string;
      persona: string[];
      project: string[];
    };
  }>;
  query: string;
  resultCount: number;
}
```

**Example Use Cases**:

- "Find prompts about tool usage mindset" → Returns relevant chunks
- "Show chat persona guidelines" → Filters to `persona: "chat"`
- "How do I handle AISMR idea generation?" → Combines semantic + filters

---

### 2. `prompts.get`

**Purpose**: Retrieve a specific prompt file by path

**Input Schema**:

```typescript
{
  filePath: string;                 // "prompts/ideagenerator-aismr.md"
  includeMetadata?: boolean;        // Default: true
}
```

**Output**:

```typescript
{
  filePath: string;
  content: string;                  // Full file content (reconstructed)
  metadata: {
    type: string;
    persona: string[];
    project: string[];
    chunkCount: number;
  };
}
```

---

### 3. `prompts.list`

**Purpose**: List all available prompt files

**Input Schema**:

```typescript
{
  type?: "persona" | "project" | "combination";  // Filter by type
  persona?: string;                              // Filter by persona
  project?: string;                              // Filter by project
}
```

**Output**:

```typescript
{
  prompts: Array<{
    filePath: string;
    type: string;
    persona: string[];
    project: string[];
  }>;
  total: number;
}
```

---

### 4. `prompts.filter`

**Purpose**: Get all chunks matching specific criteria (non-semantic)

**Input Schema**:

```typescript
{
  persona?: string;
  project?: string;
  type?: "persona" | "project" | "combination";
}
```

**Output**:

```typescript
{
  chunks: Array<{
    chunkText: string;
    filePath: string;
    metadata: PromptMetadata;
  }>;
  total: number;
}
```

---

## MCP Resources

### 1. `prompt://info`

Returns server status and corpus information:

```typescript
{
  name: "n8n-prompts-mcp-server",
  version: "0.1.0",
  corpus: {
    totalPrompts: 7,
    totalChunks: 42,
    personas: ["chat", "ideagenerator", "screenwriter", "captionhashtag"],
    projects: ["aismr"],
    lastIngestion: "2025-10-28T10:30:00Z"
  }
}
```

### 2. `status://health`

Health check endpoint for monitoring.

---

## Implementation Phases

### Phase 1: Foundation (Week 1)

**Goal**: Database + basic ingestion working locally

- [ ] Create `mcp-prompts/` directory structure
- [ ] Set up `package.json` with dependencies:
  - `@modelcontextprotocol/sdk`, `drizzle-orm`, `pg`, `pgvector`, `openai`, `llm-splitter`, `dotenv`
- [ ] Configure TypeScript (`tsconfig.json`)
- [ ] Create Drizzle schema (`src/db/schema.ts`)
- [ ] Write migration script (`scripts/runMigrations.ts`)
- [ ] Set up database connection pool (`src/db/pool.ts`)
- [ ] Create `.env.example` with required variables:
  ```bash
  DATABASE_URL=postgresql://user:pass@localhost:5432/mcp_prompts
  OPENAI_API_KEY=sk-...
  OPENAI_EMBEDDING_MODEL=text-embedding-3-small
  ```
- [ ] Test database connection

**Deliverable**: Can connect to PostgreSQL and create tables.

---

### Phase 2: Ingestion Pipeline (Week 1-2)

**Goal**: Convert markdown prompts to embeddings

- [ ] Implement file walker (`src/ingestion/walker.ts`)
  - Scan `../prompts/*.md`
  - Filter by `.md` extension
- [ ] Build metadata extractor (`src/ingestion/metadata.ts`)
  - Parse filenames: `persona-{name}`, `project-{name}`, `{persona}-{project}`
  - Classify into types: `persona`, `project`, `combination`
  - Extract persona/project arrays
- [ ] Implement chunker (`src/ingestion/chunker.ts`)
  - Use `llm-splitter` for recursive chunking (~700 tokens)
  - Maintain document-level chunks for small files
  - Preserve structure for multi-section prompts
- [ ] Create embedder (`src/ingestion/embedder.ts`)
  - Batch OpenAI API calls (100 chunks/request)
  - Handle rate limits and retries
  - Calculate checksums for change detection
- [ ] Write file processor (`src/ingestion/fileProcessor.ts`)
  - Read file content
  - Prepare chunks for database
  - Generate chunk IDs
- [ ] Build repository layer (`src/db/repository.ts`)
  - `upsertEmbeddings()`
  - `listAllFilePaths()`
  - `removeEmbeddingsByFilePaths()`
- [ ] Orchestrate in `src/ingestion/ingest.ts`
  - Coordinate walker → chunker → embedder → DB
  - Handle errors gracefully
  - Log progress
- [ ] Create CLI script (`scripts/runIngestion.ts`)
  ```bash
  npm run ingest
  ```
- [ ] Test full ingestion of all 7 prompt files

**Deliverable**: All prompts ingested into vector database with proper metadata.

---

### Phase 3: MCP Server Core (Week 2)

**Goal**: Functioning MCP server (stdio transport)

- [ ] Implement server factory (`src/server/createMcpServer.ts`)
  - Initialize `McpServer` from SDK
  - Register tools and resources
  - Handle lifecycle (connect/disconnect)
- [ ] Create `prompts.search` tool (`src/server/tools/searchPromptsTool.ts`)
  - Accept query + optional filters
  - Embed query using OpenAI
  - Perform vector similarity search with cosine distance
  - Filter by persona/project if specified
  - Return top N results with similarity scores
- [ ] Create `prompts.get` tool (`src/server/tools/getPromptTool.ts`)
  - Fetch all chunks for a file path
  - Reconstruct full content
  - Return with metadata
- [ ] Create `prompts.list` tool (`src/server/tools/listPromptsTool.ts`)
  - Query distinct file paths
  - Group by metadata
  - Return structured list
- [ ] Create `prompts.filter` tool (`src/server/tools/filterPromptsTool.ts`)
  - Filter by persona/project/type
  - Return matching chunks
- [ ] Implement resources (`src/server/resources/`)
  - `prompt://info` → corpus stats
  - `status://health` → health check
- [ ] Add Zod schemas (`src/server/schemas.ts`) for input validation
- [ ] Test with stdio transport:
  ```bash
  npm run dev
  ```

**Deliverable**: MCP server responding to tool calls via stdio.

---

### Phase 4: HTTP Transport (Week 2-3)

**Goal**: Remote access via Cloudflare tunnel

- [ ] Create HTTP server (`server.ts`)
  - Use `StreamableHTTPServerTransport` from MCP SDK
  - Handle GET, POST, DELETE, OPTIONS
  - Implement CORS and DNS rebinding protection
  - Log requests/responses
  - Graceful shutdown on signals (SIGINT, SIGTERM)
- [ ] Add HTTP-specific helpers (`src/server/httpHelpers.ts`)
  - `readJsonBody()`, `sendJsonError()`, `getRemoteAddress()`
  - Request/response logging
- [ ] Configure environment variables:
  ```bash
  MCP_HTTP_HOST=0.0.0.0
  MCP_HTTP_PORT=3456
  MCP_HTTP_PATH=/mcp
  MCP_HTTP_ALLOWED_ORIGINS=https://*.trycloudflare.com
  ```
- [ ] Set up Cloudflare tunnel (`cloudflared/config.prompts.yml`):

  ```yaml
  tunnel: <YOUR_TUNNEL_ID>
  credentials-file: /etc/cloudflared/credentials.json

  ingress:
    - hostname: n8n-prompts.your-domain.com
      service: http://localhost:3456
      originRequest:
        noTLSVerify: true
    - service: http_status:404
  ```

- [ ] Create Docker Compose override (optional):
  ```yaml
  services:
    cloudflared:
      image: cloudflare/cloudflared:latest
      command: tunnel --config /etc/cloudflared/config.prompts.yml run
      volumes:
        - ./mcp-prompts/cloudflared/config.prompts.yml:/etc/cloudflared/config.prompts.yml:ro
        - ./mcp-prompts/cloudflared/credentials:/etc/cloudflared:ro
  ```
- [ ] Test HTTP transport:
  ```bash
  npm run start
  curl -X POST http://localhost:3456/mcp \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
  ```
- [ ] Test via Cloudflare tunnel

**Deliverable**: MCP server accessible via HTTPS webhook.

---

### Phase 5: Incremental Updates (Week 3)

**Goal**: Efficient re-ingestion on prompt changes

- [ ] Create delta selector (`src/ingestion/deltaSelector.ts`)
  - Compare file checksums
  - Detect new, modified, deleted files
- [ ] Implement incremental ingestion (`src/ingestion/ingestChanged.ts`)
  - Only process changed files
  - Remove embeddings for deleted files
  - Upsert embeddings for new/modified files
- [ ] Add CLI script (`scripts/ingestChanged.ts`)
  ```bash
  npm run ingest:changed
  ```
- [ ] Update existing `scripts/update-dev-reset.js` to trigger:
  ```bash
  # After updating prompts:
  cd mcp-prompts && npm run ingest:changed
  ```

**Deliverable**: Fast prompt updates without full re-ingestion.

---

### Phase 6: Testing & Quality (Week 3-4)

**Goal**: Production-ready reliability

- [ ] Write unit tests (Jest)
  - Metadata extraction
  - Chunking logic
  - Query builders
  - Tool input validation
- [ ] Write integration tests
  - End-to-end ingestion
  - Tool invocation via MCP
  - Vector search accuracy
- [ ] Add error handling
  - Database connection failures
  - OpenAI API errors
  - Invalid tool inputs
- [ ] Performance optimization
  - Vector index tuning (IVFFlat lists parameter)
  - Connection pooling
  - Query optimization
- [ ] Documentation
  - README.md with setup instructions
  - API documentation for tools
  - Troubleshooting guide

**Deliverable**: >70% test coverage, comprehensive docs.

---

### Phase 7: Integration & Deployment (Week 4)

**Goal**: n8n workflows using MCP tools

- [ ] Configure n8n MCP integration
  - Add MCP server URL to n8n settings
  - Test tool discovery
- [ ] Create example workflows
  - "Fetch persona prompt before generation"
  - "Search for relevant guidelines based on user input"
  - "List all AISMR-related prompts"
- [ ] Set up monitoring
  - Health check endpoint
  - Request logging
  - Error alerting
- [ ] Production deployment checklist
  - Environment variable validation
  - Database backup strategy
  - Cloudflare tunnel stability
  - Rate limiting (OpenAI API)

**Deliverable**: n8n workflows successfully using MCP prompt tools.

---

## Configuration Management

### Environment Variables

**Required**:

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/mcp_prompts

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# HTTP Server
MCP_HTTP_HOST=0.0.0.0
MCP_HTTP_PORT=3456
MCP_HTTP_PATH=/mcp
```

**Optional**:

```bash
# Security
MCP_HTTP_DNS_REBINDING_PROTECTION=true
MCP_HTTP_ALLOWED_HOSTS=localhost,127.0.0.1
MCP_HTTP_ALLOWED_ORIGINS=https://*.trycloudflare.com

# Ingestion
EMBEDDING_BATCH_SIZE=100
CHUNK_STRATEGY=recursive
CHUNK_MAX_TOKENS=700

# Debug
DEBUG_MCP_HTTP=false
NODE_ENV=production
```

---

## File Processing Strategy

### Filename Parsing Logic

```typescript
function parsePromptFilename(filename: string): PromptMetadata {
  const base = filename.replace('.md', '');

  // persona-{name}.md
  if (base.startsWith('persona-')) {
    return {
      type: 'persona',
      persona: [base.replace('persona-', '')],
      project: [],
      filename,
    };
  }

  // project-{name}.md
  if (base.startsWith('project-')) {
    return {
      type: 'project',
      persona: [],
      project: [base.replace('project-', '')],
      filename,
    };
  }

  // {persona}-{project}.md
  const parts = base.split('-');
  if (parts.length === 2) {
    return {
      type: 'combination',
      persona: [parts[0]],
      project: [parts[1]],
      filename,
    };
  }

  throw new Error(`Cannot parse filename: ${filename}`);
}
```

### Chunking Strategy

1. **Document-level chunk**: Always create one chunk with full content
2. **Recursive chunks**: For files >1000 tokens, split into ~700 token chunks
3. **Preserve structure**: Respect markdown headers as split boundaries
4. **Metadata propagation**: Every chunk inherits file-level metadata

---

## Database Queries

### Semantic Search Query

```sql
SELECT
  file_path,
  chunk_text,
  metadata,
  1 - (embedding <=> $1::vector) AS similarity
FROM prompt_embeddings
WHERE
  ($2::text IS NULL OR metadata->>'persona' ? $2)
  AND ($3::text IS NULL OR metadata->>'project' ? $3)
ORDER BY embedding <=> $1::vector
LIMIT $4;
```

**Parameters**:

- `$1`: Query embedding (vector)
- `$2`: Persona filter (optional)
- `$3`: Project filter (optional)
- `$4`: Result limit

---

## Integration with n8n

### Tool Usage Examples

#### Example 1: Fetch Chat Persona Prompt

```javascript
// n8n HTTP Request node calling MCP tool
{
  "method": "POST",
  "url": "https://n8n-prompts.your-domain.com/mcp",
  "body": {
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "prompts.get",
      "arguments": {
        "filePath": "prompts/persona-chat.md"
      }
    },
    "id": 1
  }
}
```

#### Example 2: Search for Tool Usage Guidelines

```javascript
{
  "method": "POST",
  "url": "https://n8n-prompts.your-domain.com/mcp",
  "body": {
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "prompts.search",
      "arguments": {
        "query": "how to use tools and format outputs",
        "persona": "chat",
        "limit": 3
      }
    },
    "id": 2
  }
}
```

#### Example 3: List All AISMR Prompts

```javascript
{
  "method": "POST",
  "url": "https://n8n-prompts.your-domain.com/mcp",
  "body": {
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "prompts.list",
      "arguments": {
        "project": "aismr"
      }
    },
    "id": 3
  }
}
```

---

## Migration Strategy

### Transition from SQL to Vector DB

**Current Workflow**:

1. Edit `prompts/*.md`
2. Run `npm run update:dev-reset`
3. SQL inserts regenerated in `sql/prompts-inserts.sql`
4. Import into n8n database

**New Workflow**:

1. Edit `prompts/*.md`
2. Run `cd mcp-prompts && npm run ingest:changed`
3. Embeddings updated in `mcp_prompts` database
4. n8n workflows query MCP tools via HTTP

**Backward Compatibility** (optional):

- Keep SQL generation scripts for legacy workflows
- Run both systems in parallel during migration
- Phase out SQL approach once MCP proven stable

---

## Success Criteria

### Phase 1-3 (MVP)

- ✅ All 7 prompts ingested into vector database
- ✅ MCP server responds to tool calls
- ✅ `prompts.search` returns relevant results
- ✅ `prompts.get` reconstructs full files
- ✅ Metadata filters work correctly

### Phase 4-5 (Production)

- ✅ HTTP transport accessible via Cloudflare
- ✅ Incremental updates work (<30s for changed file)
- ✅ Error handling prevents crashes
- ✅ Logging provides debugging info

### Phase 6-7 (Integration)

- ✅ n8n workflows successfully call MCP tools
- ✅ Semantic search accuracy >80% (manual testing)
- ✅ Response times <2s for search queries
- ✅ Zero downtime during prompt updates

---

## Risk Mitigation

| Risk                          | Impact | Mitigation                                                                             |
| ----------------------------- | ------ | -------------------------------------------------------------------------------------- |
| OpenAI API rate limits        | High   | Batch embeddings, implement retry logic with exponential backoff                       |
| Vector search accuracy        | Medium | Test with diverse queries, tune similarity thresholds, use document + recursive chunks |
| Database performance          | Medium | Proper indexing (IVFFlat + GIN), connection pooling, query optimization                |
| Cloudflare tunnel instability | High   | Health checks, auto-restart, fallback to direct IP if needed                           |
| Metadata parsing errors       | Low    | Comprehensive tests, validation, graceful fallback                                     |
| Backward compatibility        | Medium | Run parallel with SQL system initially, gradual migration                              |

---

## Future Enhancements (Post-MVP)

1. **Hybrid Search**: Combine vector similarity with BM25 keyword search
2. **Prompt Versioning**: Track historical changes to prompts
3. **Multi-Project Support**: Database-per-project like reference MCP
4. **Prompt Templates**: Extract reusable patterns from prompts
5. **Usage Analytics**: Track which prompts are queried most
6. **Prompt Composition**: Combine multiple prompts dynamically
7. **Web UI**: Admin panel for viewing/managing prompts
8. **Caching**: Redis layer for frequently accessed prompts

---

## Next Steps

1. **Review this plan** with stakeholders
2. **Set up PostgreSQL** with pgvector extension
3. **Create `mcp-prompts/` directory** and initialize npm project
4. **Start Phase 1**: Database setup and schema creation
5. **Iterate**: Build → Test → Deploy → Gather feedback

---

## Questions to Resolve

- [ ] Should we keep SQL generation for backward compatibility?
- [ ] What's the preferred Cloudflare tunnel setup? (New tunnel or reuse existing?)
- [ ] Are there other prompt types beyond persona/project/combination?
- [ ] Should we support markdown section-level metadata (e.g., `## Tool Mindset`)?
- [ ] What's the expected query volume? (Affects indexing strategy)
- [ ] Need authentication/authorization on MCP endpoints?

---

**Last Updated**: 2025-10-28  
**Version**: 1.0  
**Author**: AI Assistant (based on mylo_mcp_reference)
