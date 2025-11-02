# Deployment Setup Guide

## Overview

This project uses Docker Compose to manage multiple environments:
- **Development environment** (`docker-compose.dev.yml`): For local development with n8n
- **Production environment** (`docker-compose.yml`): For production deployments with MCP server

## Current Setup (as of Nov 2, 2025)

### Development Stack (`docker-compose.dev.yml`)

Services:
- **n8n** (port 5678): Workflow automation platform
- **n8n-postgres** (port 5433): PostgreSQL database for n8n
- **mcp-postgres** (port 5432): PostgreSQL with pgvector for MCP server
- **cloudflared**: Cloudflare tunnel for secure access

### Access Points

1. **Local n8n**: http://localhost:5678
2. **n8n via Cloudflare Tunnel**: https://n8n.mjames.dev
3. **MCP API via Tunnel**: https://mcp-vector.mjames.dev

### Cloudflared Configuration

There are THREE cloudflared config files for different purposes:

1. **`cloudflared/config.dev.yml`** - Used by `docker-compose.dev.yml`
   - Routes n8n.mjames.dev → n8n container (internal Docker network)
   - Routes mcp-vector.mjames.dev → host.docker.internal:3456 (MCP server on host)

2. **`cloudflared/config.prompts.yml`** - Used by `docker-compose.yml` (prod/dev profiles)
   - Routes n8n.mjames.dev → host.docker.internal:5678
   - Routes mcp-vector.mjames.dev → host.docker.internal:3456

3. **`cloudflared/config.local.yml`** - For running cloudflared locally (non-Docker)
   - Routes n8n.mjames.dev → localhost:5678
   - Routes mcp-vector.mjames.dev → localhost:3456
   - Uses local file paths for credentials

## Running the Stack

### Start Development Environment

```bash
docker compose -f docker-compose.dev.yml up -d
```

This starts:
- n8n on localhost:5678
- PostgreSQL databases
- Cloudflare tunnel with proper internal routing

### Stop Development Environment

```bash
docker compose -f docker-compose.dev.yml down
```

### View Logs

```bash
# All services
docker compose -f docker-compose.dev.yml logs -f

# Specific service
docker compose -f docker-compose.dev.yml logs -f n8n
docker compose -f docker-compose.dev.yml logs -f cloudflared
```

## Common Issues & Solutions

### Issue: Can't access localhost:5678

**Symptoms**: Browser can't connect to http://localhost:5678

**Diagnosis**:
1. Check if n8n container is running:
   ```bash
   docker ps | grep n8n
   ```

2. Verify n8n is listening:
   ```bash
   curl -I http://localhost:5678
   ```

3. Check n8n logs:
   ```bash
   docker logs mcp-prompts-n8n-1
   ```

**Solutions**:
- Wait 5-10 seconds after starting for n8n to fully initialize
- Clear browser cache
- Try accessing via the Cloudflare tunnel: https://n8n.mjames.dev
- Restart the stack: `docker compose -f docker-compose.dev.yml restart`

### Issue: Multiple cloudflared instances

**Symptoms**: Multiple cloudflared containers running simultaneously

**Solution**: 
- Only run ONE docker-compose stack at a time
- If you need to switch stacks, stop the current one first:
  ```bash
  docker compose -f docker-compose.dev.yml down
  docker compose --profile prod up -d
  ```

### Issue: Port conflicts

**Symptoms**: Error about ports already in use

**Current port allocation**:
- 5678: n8n (docker-compose.dev.yml)
- 5433: n8n-postgres (docker-compose.dev.yml)
- 5432: mcp-postgres (docker-compose.dev.yml)
- 5442: mcp-postgres (docker-compose.yml prod/dev)
- 3456: MCP server (docker-compose.yml prod/dev)

**Solution**: Make sure you're not running conflicting stacks

## Production Deployment

### MCP Server Production

```bash
docker compose --profile prod up -d
```

This starts:
- MCP server on port 3456
- PostgreSQL with pgvector on port 5442
- Cloudflare tunnel

### MCP Server Development (with hot reload)

```bash
docker compose --profile dev up -d
```

This starts the same services but with source code mounted for development.

## Environment Variables

Required environment variables (in `.env` file):

```env
# OpenAI
OPENAI_API_KEY=sk-...

# Telegram (for n8n workflows)
TELEGRAM_BOT_TOKEN=...

# Database
MCP_DB_USER=mcp_prompts
MCP_DB_PASSWORD=mcp_prompts
MCP_DB_NAME=mcp_prompts

# Server
SERVER_HOST=0.0.0.0
SERVER_PORT=3456
DATABASE_URL=postgres://...
OPERATIONS_DATABASE_URL=postgres://...
```

## Cloudflare Tunnel Setup

The cloudflared tunnels require:
1. `cloudflared/credentials/mcp-vector.json` - Tunnel credentials (git-ignored)
2. `cloudflared/cert.pem` - Origin certificate (git-ignored)

These files must be obtained from Cloudflare and placed in the correct locations.

## Network Architecture

### Development Setup

```
Browser → http://localhost:5678 → Docker (port 5678) → n8n container

OR

Browser → https://n8n.mjames.dev → Cloudflare → cloudflared container → n8n container (via Docker network)
```

### Key Changes (Nov 2, 2025)

Fixed the cloudflared routing in `docker-compose.dev.yml`:
- **Before**: cloudflared tried to reach n8n via `host.docker.internal:5678` (incorrect)
- **After**: cloudflared reaches n8n via `n8n:5678` (internal Docker network)

This eliminates unnecessary network hops and prevents routing issues.

