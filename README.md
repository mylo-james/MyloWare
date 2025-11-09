# MCP Prompts V2

> **"From a text message to a published video, in five minutes."** ⭐

An agentic RAG system that turns natural language into production workflows. Send a message, get a video on TikTok.

---

## 🌟 What Is This?

V2 is an **AI agent** that:
- Understands natural language requests
- Searches its memory for context
- Discovers workflows semantically
- Executes complex production pipelines
- Remembers everything for next time

No complex commands. No manual steps. Just conversation.

**Example:**
```
You: "Create an AISMR video about rain sounds"

Casey: I'll generate 12 ideas, have you pick your favorite, 
       write the screenplay, produce the video, and upload 
       it to TikTok. Starting now...

[5 minutes later]

Casey: 🎉 Your video "Gentle Rain" is now live on TikTok!
```

That's the entire interaction.

---

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for development)
- OpenAI API key
- Telegram bot token (optional, for chat interface)

### ⚡ Fast Start (Recommended)

```bash
# Clone repo
git clone https://github.com/yourusername/mcp-prompts
cd mcp-prompts

# Install dependencies
npm install

# Environment is already set to dev (default)
# Just start the services!
npm run env:dev start

# Verify everything is running
curl http://localhost:3456/health
```

**Note:** We now use a **multi-environment setup** with separate configs for test, dev, and prod. See [Development Guide](docs/07-contributing/dev-guide.md) for details.

**Access points:**
- MCP Server: `http://localhost:3456`
- MCP Health: `http://localhost:3456/health`
- Metrics: `http://localhost:3456/metrics`
- n8n UI: `http://localhost:5678` or `https://n8n.mjames.dev`
- MCP via Cloudflare: `https://mcp-vector.mjames.dev/mcp`
- Postgres: `localhost:5432`

### Run the Automated Tests

Tests spin up an ephemeral pgvector database with Testcontainers. Make sure Docker Desktop (or the Docker daemon) is running, then execute:

```bash
npm test
```

You can still target a subset via `npm run test:unit`, `npm run test:integration`, etc. Performance tests live under `tests/performance` and can be executed separately with `npm run test:perf`.

### Cloudflare Tunnel

We ship the v1 tunnel configuration in `v2/cloudflared/`. To expose this stack over the same hostname, keep the certs/config current and run:

```bash
docker compose up cloudflared
```

The container defaults to `cloudflared/config.dev.yml`; switch the mounted config or command if you need the production tunnel.

---

## 🏗️ Architecture

V2 is radically simple: **three services, one agent**.

```
┌─────────────┐
│   Telegram  │  User sends message
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────┐
│  n8n (Agent Workflow)               │
│  • One AI agent node (GPT-4o-mini)  │
│  • MCP tool calling                 │
│  • Workflow orchestration           │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  MCP Server (Tool Interface)        │
│  • 11 tools (memory, workflow, etc) │
│  • HTTP endpoint                    │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  Postgres (with pgvector)           │
│  • Vector memories (embeddings)     │
│  • SQL state (sessions, runs)       │
│  • Full-text search                 │
└─────────────────────────────────────┘
```

**Key Principles:**
1. **One agent** - Single AI node makes all decisions
2. **Semantic discovery** - Workflows found by meaning, not name
3. **Memory as context** - Agent remembers past interactions
4. **Tool-based execution** - MCP tools for all operations
5. **State tracking** - SQL tracks execution history

See [System Overview](docs/02-architecture/system-overview.md) for details.

---

## 🛠️ Available Tools

The server exposes **11 MCP tools** across four buckets:

### Memory Tools
- `memory_search` – Hybrid vector + keyword search
- `memory_store` – Persist episodic/procedural memories with link metadata
- `memory_evolve` – Update tags, links, and summaries in-place
- `memory_searchByRun` – Filter memories tied to a legacy `runId` (still useful for migrations)

### Context Tools
- `context_get_persona` – Load persona configuration + guardrails
- `context_get_project` – Load project configuration + constraints

### Trace Coordination Tools
- `trace_create` – Create a new trace row and return a `traceId`
- `handoff_to_agent` – Resolve the next agent’s webhook, invoke n8n, and log handoff metadata
  - Special targets: `toAgent: "complete"` (marks trace completed, notifies user) and `toAgent: "error"` (marks trace failed)

### Session Tools
- `session_get_context` – Hydrate or create a chat session, returning working memory
- `session_update_context` – Persist session working memory blobs

Interactive clarifications now run through Telegram HITL nodes inside n8n workflows, so the legacy `clarify_ask` tool has been removed.

See [MCP Tools Reference](docs/06-reference/mcp-tools.md) for complete API reference.

---

## 🔌 MCP Compliance

This server is **fully standards-compliant** with the Model Context Protocol specification for seamless integration with any AI agent client.

### Standards Compliance

- ✅ **Protocol:** JSON-RPC 2.0 with MCP specification 2025-06-18
- ✅ **Transport:** Streamable HTTP with session management
- ✅ **All Three APIs:** Tools, Resources, and Prompts implemented
- ✅ **Capabilities:** Explicit capability declarations with `listChanged` notifications
- ✅ **Schemas:** Complete input and output schemas for all tools
- ✅ **Security:** DNS rebinding protection enabled

### Compatible Clients

- **Claude Desktop** - Full support for all APIs
- **n8n** - Tool calling via HTTP requests
- **Custom MCP Clients** - Standards-compliant integration

### Authentication

Currently using API key authentication via `X-API-Key` header. OAuth 2.1 with PKCE is planned for future versions but not required for internal/protected deployments.

See [MCP Integration](docs/04-integration/mcp-integration.md) for detailed integration instructions.

---

## 📚 Core Concepts

### Agentic RAG

The agent decides **when**, **what**, and **how** to retrieve:

```
Traditional RAG:
  User query → Always retrieve → Generate response

Agentic RAG:
  User query → Agent decides if retrieval needed
            → Agent chooses what to retrieve
            → Agent determines how to use results
            → Generate response
```

### Semantic Workflow Discovery

Workflows are **data, not code**. They're stored as procedural memories and discovered by understanding intent:

```typescript
// No hardcoded workflow names!
const workflows = await discoverWorkflow({
  intent: "create AISMR video from idea to upload",
  project: "aismr"
});

// Returns workflows ranked by semantic similarity
// Agent picks best match and executes
```

### Memory Types

Three types of memory, all searchable:

- **Episodic** - Past conversations, interactions, events
- **Semantic** - Facts, rules, specs, knowledge
- **Procedural** - Workflows, processes, how-to's

### Hybrid Memory Search

Combines vector similarity + full-text search using Reciprocal Rank Fusion (RRF):

```typescript
await searchMemories({
  query: "AISMR rain ideas",
  memoryTypes: ["episodic", "semantic"],
  project: "aismr",
  temporalBoost: true,  // Recent memories rank higher
  expandGraph: true,    // Follow memory links
  limit: 10
});
```

---

## 🎯 The North Star

Read [NORTH_STAR.md](NORTH_STAR.md) for the complete vision: a detailed walkthrough of the entire system from "user sends message" to "video live on TikTok" in 5 minutes.

For organized documentation, see [docs/README.md](docs/README.md).

**The happy path:**
1. User: "Create AISMR video about rain"
2. Agent loads context (persona, project, memory)
3. Agent discovers "Complete Video Production" workflow
4. Agent generates 12 ideas (30s)
5. User selects favorite
6. Agent writes screenplay with guardrails (45s)
7. Agent generates video (3min)
8. Agent uploads to TikTok (30s)
9. Done! Video is live.

**Total time: ~5 minutes**

---

## 📖 Documentation

- **[docs/README.md](docs/README.md)** - Documentation index and navigation
- **[NORTH_STAR.md](NORTH_STAR.md)** - The complete vision and walkthrough
- **[System Overview](docs/02-architecture/system-overview.md)** - Architecture
- **[MCP Tools](docs/06-reference/mcp-tools.md)** - Complete tool reference
- **[Quick Start](docs/01-getting-started/quick-start.md)** - Get running in 5 minutes
- **[Coding Standards](docs/07-contributing/coding-standards.md)** - Development guidelines

See `docs/README.md` for the docs index and writing guidance. Use Context7 to retrieve official vendor documentation (OpenAI, n8n, MCP) rather than copying external content into this repo.

---

## 🧪 Testing

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# Performance tests
npm run test:perf

# Coverage report
npm run test:coverage
```

**Test coverage:** 50%+ (interim floor; raising to 80% in Epic 7)

---

## 🔧 Development

```bash
# Type checking
npm run type-check

# Linting
npm run lint
npm run lint:fix

# Formatting
npm run format
npm run format:check

# Database management
npm run db:reset    # Wipe and recreate
npm run db:migrate  # Run migrations
npm run db:seed     # Load development data

# Start in development mode
npm run dev
```

---

## 📊 Monitoring

Prometheus metrics available at `/metrics`:

- Tool call duration and errors
- Memory search performance
- Workflow execution stats
- Database query times
- Active session count

Example queries:
```promql
# Average search duration
rate(memory_search_duration_ms_sum[5m]) / rate(memory_search_duration_ms_count[5m])

# P95 tool call duration
histogram_quantile(0.95, mcp_tool_call_duration_ms_bucket)
```

---

## 🎨 Technology Stack

**Runtime:**
- Node.js + TypeScript
- Fastify (HTTP server)
- Postgres with pgvector (vector + SQL database)
- Drizzle ORM (type-safe queries)
- OpenAI API (embeddings + summarization)
- n8n (agent workflow + orchestration)

**Development:**
- Vitest (testing)
- ESLint + Prettier (code quality)
- Docker Compose (local development)
- Prometheus (metrics)

---

## 🤝 Contributing

1. Follow [red-green-refactor](https://github.com/yourusername/mcp-prompts/wiki/Workflow)
2. Always write tests
3. Keep coverage above 50% (interim floor; target is 80% once stability work completes)
4. Follow [Coding Standards](docs/07-contributing/coding-standards.md)
5. Never skip Husky hooks

See [Development Guide](docs/07-contributing/dev-guide.md) for complete workflow.

---

## 📝 License

MIT

---

## 🙏 Acknowledgments

Built on the shoulders of giants:
- MCP Protocol (Model Context Protocol)
- pgvector (Postgres vector extension)
- n8n (workflow automation)
- OpenAI (embeddings and LLMs)

---

**Ready to build?** Start with [NORTH_STAR.md](NORTH_STAR.md) to understand the vision, then see [docs/README.md](docs/README.md) for organized documentation.

**Questions?** Read the docs or check the code—it's designed to be readable.

**Let's turn messages into videos.** 🎬
