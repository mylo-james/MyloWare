# MCP Prompts

A Model Context Protocol (MCP) server providing prompt management, vector search, and workflow orchestration for AI video ideation.

## Features

- **Prompt Management**: Store, version, and retrieve prompts with semantic search
- **Vector Search**: pgvector-powered similarity search with temporal decay
- **Episodic Memory**: Conversation history with semantic retrieval
- **Workflow Orchestration**: Multi-stage workflows with AI-driven approvals
- **Telegram Integration**: Notifications for workflow progress
- **Observability**: Prometheus metrics, health checks, structured logging
- **Production Ready**: Rate limiting, typed errors, comprehensive testing, CI/CD

## Quick Start

### Local Development

```bash
# Start the development environment (n8n + databases + cloudflared)
npm run dev:up

# Check if everything is running
npm run services:check

# Start the MCP server (in another terminal)
npm run dev

# Access services
# - n8n: http://localhost:5678 or https://n8n.mjames.dev
# - MCP Server: http://localhost:3456 or https://mcp-vector.mjames.dev
# - Metrics: http://localhost:3456/metrics
```

See [SCRIPTS_CHEATSHEET.md](SCRIPTS_CHEATSHEET.md) for quick reference or [docs/SCRIPTS_GUIDE.md](docs/SCRIPTS_GUIDE.md) for full documentation.

### Production Deployment

```bash
# Install dependencies
npm install

# Set environment variables (see .env.example)
export DATABASE_URL=postgresql://...
export OPENAI_API_KEY=sk-...

# Run migrations
npm run db:migrate

# Start production stack
npm run stack:prod
```

See [docs/DEPLOYMENT_SETUP.md](docs/DEPLOYMENT_SETUP.md) for detailed deployment guide.

## Architecture

```
┌─────────────┐
│  Telegram   │
│   (User)    │
└──────┬──────┘
       │
       v
┌─────────────┐      ┌──────────────┐      ┌────────────────┐
│     n8n     │─────>│  MCP Server  │─────>│   PostgreSQL   │
│  Workflows  │<─────│   (Fastify)  │<─────│   + pgvector   │
└─────────────┘      └──────────────┘      └────────────────┘
                            │
                            v
                     ┌──────────────┐
                     │   OpenAI     │
                     │  (Embeddings)│
                     └──────────────┘
```

## API Endpoints

### MCP Tools (Model Context Protocol)

- `POST /mcp` - Execute MCP tools via JSON-RPC
  - `prompt_get` - Retrieve prompts by persona/project
  - `prompts.search` - Semantic/keyword/hybrid search
  - `conversation.remember` - Retrieve episodic memory
  - `conversation.store` - Store conversation turns

### REST API

**Workflows**
- `GET /api/workflow-runs` - List workflow runs
- `POST /api/workflow-runs` - Create workflow run
- `GET /api/workflow-runs/:id` - Get workflow run details
- `PATCH /api/workflow-runs/:id` - Update workflow run

**System**
- `GET /health` - Health check with database status
- `GET /metrics` - Prometheus metrics

See [docs/API.md](docs/API.md) for full API documentation.

## Development

### Prerequisites

- Node.js 20+
- PostgreSQL 16 with pgvector extension
- Docker & Docker Compose (for local development)

### Setup

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your values
vim .env

# Start local services (PostgreSQL + n8n)
docker compose -f docker-compose.dev.yml up -d

# Run migrations
npm run db:migrate

# Start development server (with hot reload)
npm run dev
```

### Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test src/server/routes/workflow-runs.test.ts

# Lint code
npm run lint

# Type check
npm run type-check

# Build
npm run build
```

### Key Commands

```bash
# Development
npm run dev              # Start with hot reload
npm run db:migrate       # Run migrations
npm run db:studio        # Open Drizzle Studio

# Testing
npm test                 # Run tests
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage

# Production
npm run build           # Build for production
npm start               # Start production server

# Utilities
npm run lint            # Lint code
npm run type-check      # TypeScript check
npm run format          # Format with Prettier
```

## Project Structure

```
mcp-prompts/
├── src/
│   ├── server/              # Fastify server
│   │   ├── routes/          # API routes
│   │   ├── tools/           # MCP tool implementations
│   │   ├── metrics.ts       # Prometheus metrics
│   │   └── errorHandler.ts # Centralized error handling
│   ├── services/            # Business logic
│   ├── db/                  # Database layer
│   │   ├── repository.ts    # Vector/prompt repository
│   │   ├── operations/      # Operations database
│   │   └── migrations/      # SQL migrations
│   ├── vector/              # Embeddings & search
│   └── types/               # TypeScript types
├── workflows/               # n8n workflow definitions
├── docs/                    # Documentation
├── drizzle/                 # Database migrations
└── scripts/                 # Utility scripts
```

## Documentation

- [Local Development Guide](docs/LOCAL-DEVELOPMENT.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Code Review - Claude](docs/review-claude.md)
- [Code Review - Codex](docs/REVIEW-CODEX.md)
- [Implementation Plan](docs/PLAN.md)

## Configuration

Key environment variables:

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/db
OPERATIONS_DATABASE_URL=postgresql://user:pass@host:5432/ops_db

# OpenAI
OPENAI_API_KEY=sk-proj-...

# Telegram
TELEGRAM_BOT_TOKEN=123456:ABC...

# Server
SERVER_PORT=3456
SERVER_HOST=0.0.0.0
NODE_ENV=production

# Rate Limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000

# n8n Integration
N8N_WEBHOOK_BASE=https://n8n.mjames.dev
```

See `.env.example` for all options.

## Monitoring

### Prometheus Metrics

Available at `GET /metrics`:

- `mcp_prompts_http_request_duration_seconds` - HTTP request latency
- `mcp_prompts_http_requests_total` - Total HTTP requests
- `mcp_prompts_db_query_duration_seconds` - Database query duration
- `mcp_prompts_vector_search_duration_seconds` - Vector search latency

### Health Check

```bash
curl http://localhost:3456/health | jq

{
  "status": "ok",
  "timestamp": "2025-11-02T19:30:00.000Z",
  "checks": {
    "database": { "status": "ok" },
    "operationsDatabase": { "status": "ok" }
  }
}
```

## CI/CD

GitHub Actions workflow runs on every push/PR:

- ✅ Lint (ESLint)
- ✅ Type check (TypeScript)
- ✅ Tests (Vitest)
- ✅ Build
- ✅ Security audit

See `.github/workflows/ci.yml`

## Contributing

1. Follow the development workflow [[memory:6094533]]
2. Always pull main first
3. Create a feature branch
4. Follow red-green-refactor
5. Ensure all tests pass
6. Never skip husky hooks
7. Create PR and verify CI passes

## License

MIT

## Support

- Issues: [GitHub Issues](https://github.com/yourusername/mcp-prompts/issues)
- Docs: [docs/](docs/)
