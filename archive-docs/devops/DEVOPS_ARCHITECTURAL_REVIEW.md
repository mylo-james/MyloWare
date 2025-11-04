# DevOps Architecture Review & Recommendations

**Date:** November 4, 2025  
**Status:** Critical Issues Identified

---

## Executive Summary

Your DevOps setup has **significant architectural confusion** due to:

1. **Two conflicting Docker Compose configurations** running simultaneously
2. **Three different database instances** with unclear usage patterns
3. **Multiple npm dev processes** stuck in the background with no active server
4. **Incorrect Cloudflare tunnel routing** configuration
5. **Missing environment variable documentation and validation**
6. **No clear separation between dev and prod environments**

**Critical Issue:** Your MCP server is **NOT running** despite having 3 stale npm processes in the background. The Cloudflare tunnel is routing to `host.docker.internal:3456` but nothing is listening.

---

## Current Architecture Analysis

### What's Actually Running

```
DOCKER CONTAINERS (docker-compose.dev.yml):
├── n8n-postgres         (port 5433) ✅ HEALTHY
├── n8n                  (port 5678) ✅ RUNNING
├── mcp-postgres         (port 5434) ✅ HEALTHY
└── cloudflared          ✅ CONNECTED

HOST PROCESSES:
├── npm run dev (PID 10543) ❌ STALE (started 8:46 PM)
├── npm run dev (PID 10680) ❌ STALE (started 8:46 PM)
└── npm run dev (PID 10797) ❌ STALE (started 8:47 PM)

PORT 3456 (MCP Server): ❌ NOTHING LISTENING
```

### Database Chaos

You have **THREE PostgreSQL instances** with confusing configurations:

| Instance           | Port | Image                  | Usage               | Configured In          |
| ------------------ | ---- | ---------------------- | ------------------- | ---------------------- |
| n8n-postgres       | 5433 | postgres:16-alpine     | n8n workflows       | docker-compose.dev.yml |
| mcp-postgres (dev) | 5434 | pgvector/pgvector:pg16 | MCP prompts/vectors | docker-compose.dev.yml |
| postgres (prod)    | 5442 | ankane/pgvector:latest | MCP prompts/vectors | docker-compose.yml     |

**Problems:**

- The prod postgres (port 5442) is **never started** in your workflow
- You have **two different pgvector images** (`ankane/pgvector` vs `pgvector/pgvector`)
- Environment variables point to non-existent databases
- No clear distinction between main database and operations database

### Environment Variable Confusion

Your application expects:

```bash
DATABASE_URL=postgres://...              # Main database for prompts/embeddings
OPERATIONS_DATABASE_URL=postgres://...   # Operations database for workflow runs
```

But your Docker Compose files define:

```bash
MCP_DB_USER=mcp_prompts
MCP_DB_PASSWORD=mcp_prompts
MCP_DB_NAME=mcp_prompts
```

**The mismatch means:**

- Your `.env` file probably doesn't match the running containers
- Database migrations may be running against the wrong database
- Connection strings are hardcoded in docker-compose files

---

## Critical Issues

### Issue #1: MCP Server Not Running ⚠️ CRITICAL

**Problem:**  
Port 3456 has nothing listening, but Cloudflare tunnel routes to it.

**Evidence:**

```bash
$ lsof -i :3456
Port 3456 is not in use

$ ps aux | grep tsx
# 3 stale npm processes from 8:46-8:47 PM
```

**Impact:**

- All API calls to `https://mcp-vector.mjames.dev` return connection errors
- n8n workflows cannot communicate with MCP server
- Tunnel is established but routing to nothing

**Root Cause:**  
The `npm run dev` processes failed to start but didn't exit cleanly, leaving orphaned processes.

---

### Issue #2: Docker Compose Configuration Split ⚠️ CRITICAL

**Problem:**  
You have TWO docker-compose files with overlapping services:

**docker-compose.dev.yml:**

- Intended for local development
- Runs n8n, mcp-postgres, cloudflared
- Uses pgvector/pgvector:pg16

**docker-compose.yml:**

- Has BOTH prod and dev profiles
- Runs postgres, server containers, cloudflared
- Uses ankane/pgvector:latest
- **Never actually used** based on container names

**Impact:**

- Confusion about which compose file to use
- Duplicate cloudflared configurations
- Different database images/ports between dev and prod
- Scripts reference both compose files inconsistently

---

### Issue #3: Cloudflared Routing Misconfiguration ⚠️ HIGH

**Problem:**  
Cloudflared is configured to route to services that don't exist or use wrong hostnames.

**config.dev.yml (currently active):**

```yaml
ingress:
  - hostname: n8n.mjames.dev
    service: http://n8n:5678 # ✅ CORRECT (internal Docker network)
  - hostname: mcp-vector.mjames.dev
    service: http://host.docker.internal:3456 # ❌ NOTHING LISTENING
```

**config.prompts.yml (not used):**

```yaml
ingress:
  - hostname: mcp-vector.mjames.dev
    service: http://host.docker.internal:3456 # Same issue
  - hostname: n8n.mjames.dev
    service: http://host.docker.internal:5678 # ❌ WRONG (n8n in Docker)
```

**Impact:**

- MCP server API unreachable via tunnel
- If you switch compose files, n8n routing breaks

---

### Issue #4: Database Schema Confusion ⚠️ HIGH

**Problem:**  
Your application uses TWO database connection strings but Docker only runs ONE database per stack.

**Application Code:**

```typescript
// src/db/pool.ts
const connectionString = process.env.DATABASE_URL;

// src/db/operations/pool.ts
const connectionString = process.env.OPERATIONS_DATABASE_URL;
```

**Docker Setup:**

```yaml
# docker-compose.dev.yml - Only ONE mcp-postgres
mcp-postgres:
  ports: - '5434:5432'
  environment:
    POSTGRES_DB: mcp_prompts
    POSTGRES_USER: postgres
    POSTGRES_PASSWORD: postgres
```

**Questions:**

- Are you using one database with two schemas?
- Or should there be two separate databases?
- Your docs mention `CREATE DATABASE mcp_operations` but it's never created
- Migrations run against both URLs but point to same database

---

### Issue #5: Hardcoded Connection Strings ⚠️ MEDIUM

**Problem:**  
Database URLs are hardcoded in docker-compose files instead of using environment variables.

**docker-compose.yml:**

```yaml
environment:
  DATABASE_URL: postgres://mcp_prompts:mcp_prompts@postgres:5432/mcp_prompts
  OPERATIONS_DATABASE_URL: postgres://mcp_prompts:mcp_prompts@postgres:5432/mcp_prompts
```

**Impact:**

- Can't change database credentials without editing compose file
- Same connection string for both DATABASE_URL and OPERATIONS_DATABASE_URL
- Different credentials between dev and prod stacks
- `.env` file doesn't control database connections for Docker containers

---

## Recommended Architecture

Here's a clean, production-ready architecture:

### Option A: Single Database, Multiple Schemas (Recommended)

```
┌─────────────────────────────────────────────────────────────┐
│                      Host Machine                            │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │         MCP Server (Node.js)                       │    │
│  │         Port: 3456                                 │    │
│  │         Mode: npm run dev (hot reload)             │    │
│  │                                                    │    │
│  │  Connects to:                                      │    │
│  │  • postgres://postgres:postgres@localhost:5434/mcp │    │
│  │    - Schema: public (prompts, embeddings)          │    │
│  │    - Schema: operations (workflow_runs, videos)    │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Docker (docker-compose.dev.yml)                │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │   PostgreSQL     │  │      n8n         │               │
│  │   (pgvector)     │  │   Port: 5678     │               │
│  │   Port: 5434     │  │                  │               │
│  │                  │  │  Uses n8n-postgres│               │
│  │  Database: mcp   │  └──────────────────┘               │
│  │  Schemas:        │                                      │
│  │  • public        │  ┌──────────────────┐               │
│  │  • operations    │  │  n8n-postgres    │               │
│  └──────────────────┘  │  Port: 5433      │               │
│                        └──────────────────┘               │
│                                                              │
│  ┌──────────────────────────────────────────────────┐     │
│  │         Cloudflare Tunnel                        │     │
│  │  • n8n.mjames.dev → n8n:5678                    │     │
│  │  • mcp-vector.mjames.dev → host:3456            │     │
│  └──────────────────────────────────────────────────┘     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Option B: Separate Databases (Alternative)

If operations truly need isolation:

```
MCP Server connects to:
  DATABASE_URL: postgres://...@localhost:5434/mcp_prompts
  OPERATIONS_DATABASE_URL: postgres://...@localhost:5434/mcp_operations

Docker runs:
  mcp-postgres:
    - Database: mcp_prompts (prompts, embeddings, memories)
    - Database: mcp_operations (workflow_runs, videos, episodic)
```

---

## Implementation Plan

### Phase 1: Emergency Cleanup (Do This NOW)

**Step 1: Kill stale processes**

```bash
# Kill all stale npm/tsx processes
pkill -f "npm run dev"
pkill -f "tsx watch"
```

**Step 2: Stop all Docker containers**

```bash
cd /Users/mjames/Code/mcp-prompts
docker compose -f docker-compose.dev.yml down
docker compose --profile prod down
docker compose --profile dev down
```

**Step 3: Verify ports are free**

```bash
lsof -i :3456  # Should be empty
lsof -i :5678  # Should be empty
lsof -i :5434  # Should be empty
```

### Phase 2: Fix Database Configuration

**Step 1: Decide on database architecture**

Choose Option A (single DB, multiple schemas) or Option B (separate databases).

**For Option A (Recommended):**

Create databases and schemas:

```sql
-- Connect to mcp-postgres
psql postgres://postgres:postgres@localhost:5434/mcp

-- Create operations schema
CREATE SCHEMA IF NOT EXISTS operations;

-- Enable pgvector in both schemas
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

Update environment variables:

```bash
# .env
DATABASE_URL=postgres://postgres:postgres@localhost:5434/mcp
OPERATIONS_DATABASE_URL=postgres://postgres:postgres@localhost:5434/mcp

# Use search_path in operations code to access operations schema
```

**Step 2: Update Drizzle configs**

Create separate config for operations with schema:

```typescript
// drizzle.operations.config.ts
export default defineConfig({
  schema: './src/db/operations/schema.ts',
  out: './drizzle-operations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.OPERATIONS_DATABASE_URL ?? '',
  },
  schemaFilter: ['operations'], // Add this
});
```

### Phase 3: Consolidate Docker Compose Files

**Goal:** One compose file for dev, clear production strategy.

**Step 1: Keep docker-compose.dev.yml, remove duplicate postgres from docker-compose.yml**

Update `docker-compose.yml` to remove the postgres service (rely on dev's postgres):

```yaml
# docker-compose.yml (simplified)
services:
  server-prod:
    # ... existing config
    environment:
      DATABASE_URL: ${DATABASE_URL} # From .env, points to external DB
      OPERATIONS_DATABASE_URL: ${OPERATIONS_DATABASE_URL}

  # Remove postgres service entirely - use external managed DB in production
```

**Step 2: Update docker-compose.dev.yml to use consistent environment**

```yaml
services:
  mcp-postgres:
    image: pgvector/pgvector:pg16 # Stick with one image
    environment:
      POSTGRES_DB: mcp
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - '5434:5432'
    volumes:
      - mcp_postgres_data:/var/lib/postgresql/data
      - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/init.sql # Create operations schema
```

Create `scripts/init-db.sql`:

```sql
-- Auto-run on container first start
CREATE SCHEMA IF NOT EXISTS operations;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### Phase 4: Fix Cloudflared Configuration

**Step 1: Simplify to one config for dev**

Keep `config.dev.yml` as-is (it's correct):

```yaml
ingress:
  - hostname: n8n.mjames.dev
    service: http://n8n:5678 # Internal Docker network
  - hostname: mcp-vector.mjames.dev
    service: http://host.docker.internal:3456 # Host machine
  - service: http_status:404
```

**Step 2: For production, use external database**

Production should NOT run databases in Docker. Use managed PostgreSQL (Supabase, AWS RDS, Railway, etc.) and only run the application container.

### Phase 5: Create Unified Startup Script

**scripts/start-dev-environment.sh:**

```bash
#!/bin/bash
set -e

echo "🚀 Starting MCP Development Environment"

# Check for required env vars
if [ ! -f .env ]; then
  echo "❌ .env file not found. Copy .env.example and fill in values."
  exit 1
fi

# Source environment
source .env

# Validate required vars
: "${DATABASE_URL:?❌ DATABASE_URL not set in .env}"
: "${OPENAI_API_KEY:?❌ OPENAI_API_KEY not set in .env}"

# Stop any existing processes
echo "🧹 Cleaning up existing processes..."
pkill -f "npm run dev" || true
pkill -f "tsx watch" || true

# Start Docker services
echo "🐳 Starting Docker services..."
docker compose -f docker-compose.dev.yml up -d

# Wait for database
echo "⏳ Waiting for database..."
sleep 5
until docker compose -f docker-compose.dev.yml exec -T mcp-postgres pg_isready -U postgres; do
  echo "   Database not ready, waiting..."
  sleep 2
done

# Run migrations
echo "📊 Running database migrations..."
npm run db:migrate
npm run db:operations:migrate

# Start MCP server on host
echo "🖥️  Starting MCP server..."
npm run dev &

# Wait for server to be ready
echo "⏳ Waiting for MCP server..."
sleep 5
until curl -sf http://localhost:3456/health > /dev/null; do
  echo "   Server not ready, waiting..."
  sleep 2
done

echo "✅ Development environment ready!"
echo ""
echo "📍 Access points:"
echo "   n8n:        http://localhost:5678"
echo "   n8n:        https://n8n.mjames.dev"
echo "   MCP Server: http://localhost:3456"
echo "   MCP API:    https://mcp-vector.mjames.dev"
echo ""
echo "📊 Check status:"
echo "   docker compose -f docker-compose.dev.yml ps"
echo "   curl http://localhost:3456/health"
```

Make it executable:

```bash
chmod +x scripts/start-dev-environment.sh
```

Add to package.json:

```json
{
  "scripts": {
    "dev:start": "./scripts/start-dev-environment.sh",
    "dev:stop": "pkill -f 'npm run dev' && docker compose -f docker-compose.dev.yml down"
  }
}
```

### Phase 6: Document Environment Variables

**Create .env.example:**

```bash
# === Required ===
DATABASE_URL=postgres://postgres:postgres@localhost:5434/mcp
OPERATIONS_DATABASE_URL=postgres://postgres:postgres@localhost:5434/mcp
OPENAI_API_KEY=sk-your-key-here

# === Server ===
NODE_ENV=development
SERVER_HOST=0.0.0.0
SERVER_PORT=3456

# === Optional: n8n Integration ===
TELEGRAM_BOT_TOKEN=your-telegram-bot-token

# === Optional: Security ===
MCP_API_KEY=your-api-key-for-authentication

# === Optional: CORS ===
HTTP_ALLOWED_ORIGINS=https://n8n.mjames.dev,http://localhost:5678
HTTP_ALLOWED_HOSTS=mcp-vector.mjames.dev,localhost

# === Optional: Rate Limiting ===
HTTP_RATE_LIMIT_MAX=100
HTTP_RATE_LIMIT_WINDOW_MS=60000
```

### Phase 7: Production Deployment Strategy

**For production, DO NOT use Docker for databases.**

**Recommended stack:**

```
┌─────────────────────────────────────────┐
│         Managed PostgreSQL              │
│    (Supabase / Railway / AWS RDS)       │
│                                         │
│    Databases:                           │
│    • mcp (with public + operations)     │
│                                         │
└─────────────────────────────────────────┘
                    ▲
                    │
┌─────────────────────────────────────────┐
│      Fly.io / Railway / Docker          │
│                                         │
│    ┌─────────────────────────────┐     │
│    │   MCP Server Container      │     │
│    │   (from Dockerfile)         │     │
│    │   Port: 3456                │     │
│    └─────────────────────────────┘     │
│                                         │
│    ┌─────────────────────────────┐     │
│    │   Cloudflare Tunnel         │     │
│    │   Routes to server:3456     │     │
│    └─────────────────────────────┘     │
└─────────────────────────────────────────┘
```

**Deployment steps:**

1. Provision managed PostgreSQL
2. Run migrations against production DB
3. Build Docker image: `docker build -t mcp-server:prod .`
4. Deploy to Fly.io/Railway with environment variables
5. Run cloudflared tunnel (or use Fly.io's built-in routing)

---

## Migration Checklist

- [ ] **Emergency:** Kill stale processes and stop all containers
- [ ] **Database:** Decide single DB vs separate DB approach
- [ ] **Database:** Create operations schema or database
- [ ] **Config:** Update drizzle configs with schema filtering
- [ ] **Compose:** Consolidate docker-compose files
- [ ] **Compose:** Add init-db.sql script
- [ ] **Env:** Create .env.example with all variables
- [ ] **Env:** Update .env with correct connection strings
- [ ] **Scripts:** Create unified start-dev-environment.sh script
- [ ] **Scripts:** Update package.json scripts
- [ ] **Migrations:** Run migrations against new schema setup
- [ ] **Testing:** Verify MCP server starts and connects to DB
- [ ] **Testing:** Verify n8n can reach MCP via tunnel
- [ ] **Testing:** Verify health endpoint returns ok
- [ ] **Docs:** Update LOCAL-DEVELOPMENT.md with new flow
- [ ] **Docs:** Update DEPLOYMENT.md with production strategy
- [ ] **Production:** Plan migration to managed database
- [ ] **Production:** Remove docker-compose.yml prod profile

---

## Quick Wins (Do These First)

### 1. Get MCP Server Running (5 minutes)

```bash
# Clean slate
pkill -f "npm run dev"
docker compose -f docker-compose.dev.yml restart mcp-postgres

# Create .env if missing
cat > .env << 'EOF'
DATABASE_URL=postgres://postgres:postgres@localhost:5434/mcp
OPERATIONS_DATABASE_URL=postgres://postgres:postgres@localhost:5434/mcp
OPENAI_API_KEY=your-key-here
SERVER_PORT=3456
SERVER_HOST=0.0.0.0
NODE_ENV=development
EOF

# Run migrations
npm run db:migrate

# Start server
npm run dev
```

### 2. Verify Everything Works (2 minutes)

```bash
# Check server health
curl http://localhost:3456/health | jq

# Check database connection
curl http://localhost:3456/health | jq '.checks.database'

# Check tunnel routing
curl https://mcp-vector.mjames.dev/health | jq
```

### 3. Document Current State (10 minutes)

Update DEPLOYMENT_SETUP.md with actual working commands.

---

## Maintenance Recommendations

### Daily Development Workflow

```bash
# Start everything
npm run dev:start

# Check status
npm run dev:status

# View logs
npm run dev:logs

# Stop everything
npm run dev:stop
```

### Weekly Tasks

- Review Docker volumes: `docker system df`
- Check database size: `SELECT pg_size_pretty(pg_database_size('mcp'));`
- Review error logs: `npm run dev:logs | grep ERROR`

### Monthly Tasks

- Update dependencies: `npm update`
- Review and clean old migrations
- Backup database: `pg_dump $DATABASE_URL > backup.sql`

---

## Conclusion

Your DevOps setup has good bones but suffers from **configuration drift** and **unclear separation of concerns**. The recommended fixes will give you:

✅ **One clear development workflow**  
✅ **Predictable database connections**  
✅ **Working MCP server with proper routing**  
✅ **Production-ready architecture**  
✅ **Easy onboarding for new developers**

**Estimated time to fix:** 2-3 hours

**Priority order:**

1. Get MCP server running (CRITICAL)
2. Consolidate database configuration (HIGH)
3. Create unified startup script (HIGH)
4. Clean up Docker Compose files (MEDIUM)
5. Plan production migration (MEDIUM)

Let me know which approach you want to take and I can help implement it step by step.
