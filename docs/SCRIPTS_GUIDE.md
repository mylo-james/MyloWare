# Scripts Guide

Complete reference for all npm scripts and utilities in this project.

## 🚀 Quick Start

### Development Environment

```bash
# Start the full dev environment (n8n + databases + cloudflared)
npm run dev:up

# Check if everything is running properly
npm run services:check

# View logs
npm run dev:logs

# Stop the dev environment
npm run dev:down
```

### MCP Server Development

```bash
# Start MCP server in watch mode (auto-reload on changes)
npm run dev

# Run migrations first if needed
npm run db:migrate
```

## 📦 Docker Stack Management

### Development Stack (`docker-compose.dev.yml`)

| Command | Description |
|---------|-------------|
| `npm run dev:up` | Start n8n, databases, cloudflared in detached mode |
| `npm run dev:down` | Stop all dev services |
| `npm run dev:restart` | Restart all services (or specify service name) |
| `npm run dev:logs` | Follow logs from all services |
| `npm run dev:status` | Check health of all services |
| `npm run dev:clean` | Stop and remove volumes (fresh start) |

**Examples:**

```bash
# Restart just n8n
npm run dev:restart n8n

# View logs for just cloudflared
docker compose -f docker-compose.dev.yml logs -f cloudflared

# Start without detaching (see logs in console)
tsx scripts/manageDevStack.ts up
```

### Production Stack

For production deployment, see [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions. Production uses Docker Compose directly:

```bash
docker compose --profile prod up -d
docker compose --profile prod down
```

## 🔍 Service Health & Status

```bash
# Comprehensive health check of all services
npm run services:check
```

This checks:
- Docker container status
- HTTP endpoint accessibility
- Active Docker Compose stacks
- Quick access URLs

**Example output:**
```
Service Health Status:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
n8n (localhost)        Container: running      HTTP: ✅ OK
MCP Server (localhost) Container: running      HTTP: ✅ OK
n8n Postgres           Container: running      HTTP: n/a
MCP Postgres           Container: running      HTTP: n/a
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 🗄️ Database Management

| Command | Description |
|---------|-------------|
| `npm run db:migrate` | Run main database migrations |
| `npm run db:migrate-ops` | Run operations database migrations |
| `npm run db:wipe-ops` | Wipe operations database (⚠️ destructive) |
| `npm run db:ingest` | Ingest prompts from `prompts/` directory |
| `npm run db:studio` | Open Drizzle Studio (database GUI) |

**Workflow:**
```bash
# After pulling changes that include new migrations
npm run db:migrate
npm run db:migrate-ops

# Browse/edit data in GUI
npm run db:studio

# Re-ingest prompts after updating prompt files
npm run db:ingest
```

## 🔄 Workflow & n8n Operations

| Command | Description |
|---------|-------------|
| `npm run workflow:sync-push` | Push local workflows to n8n (with schema injection) |
| `npm run workflow:sync-pull` | Pull workflows from n8n to local files (with schema extraction) |
| `npm run workflow:validate` | Validate workflows and tool specifications |

**Workflow:**
```bash
# After editing workflows in n8n UI
npm run workflow:sync-pull

# After editing workflow files locally
npm run workflow:sync-push

# Validate workflows before committing
npm run workflow:validate
```

## 🌐 Cloudflare Tunnel

| Command | Description |
|---------|-------------|
| `npm run util:tunnel` | Run cloudflared locally (non-Docker) |

**Note:** Typically cloudflared runs in Docker via `dev:up`, but you can run it locally for debugging.

## 🛠️ Development Tools

| Command | Description |
|---------|-------------|
| `npm run dev` | Start MCP server with hot reload |
| `npm run build` | Build TypeScript to JavaScript |
| `npm start` | Run built server (production mode) |
| `npm run lint` | Lint code with ESLint |
| `npm run format` | Format code with Prettier |
| `npm test` | Run all tests |

## ✅ Validation & QA

| Command | Description |
|---------|-------------|
| `npm run workflow:validate` | Validate workflows and tool specifications |
| `npm test` | Run full test suite with Vitest |
| `npm run test:watch` | Run tests in watch mode |
| `npm run type-check` | TypeScript type checking without build |

## 🛠️ Utilities

| Command | Description |
|---------|-------------|
| `npm run util:archive` | Archive AISMR videos |
| `npm run util:backfill` | Backfill workflow runs to episodic memory |
| `npm run util:tunnel` | Run cloudflared tunnel locally |

## 🔧 Custom Scripts

### Low-level Docker Commands

If the npm scripts don't cover your use case:

```bash
# Dev stack
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml logs -f n8n
docker compose -f docker-compose.dev.yml restart cloudflared
docker compose -f docker-compose.dev.yml down -v

# Production stack
docker compose --profile prod up -d
docker compose --profile prod logs -f server-prod
docker compose --profile prod down
```

### Manual Service Checks

```bash
# Check n8n
curl -I http://localhost:5678

# Check MCP server health
curl http://localhost:3456/health

# Check MCP server metrics
curl http://localhost:3456/metrics

# List all containers
docker ps

# View specific container logs
docker logs -f mcp-prompts-n8n-1
docker logs -f mcp-prompts-server
docker logs -f mcp-prompts-cloudflared-1
```

## 🎯 Common Workflows

### Starting a Development Session

```bash
# 1. Start the dev environment
npm run dev:up

# 2. Check everything is healthy
npm run services:check

# 3. Run any pending migrations
npm run db:migrate

# 4. Start the MCP server in watch mode (separate terminal)
npm run dev

# 5. Access n8n
open http://localhost:5678
```

### Troubleshooting Issues

```bash
# 1. Check service status
npm run services:check

# 2. View logs
npm run dev:logs

# 3. Restart services
npm run dev:restart

# 4. If still broken, clean slate
npm run dev:clean
npm run dev:up
```

### Deploying Changes

```bash
# 1. Pull latest changes
git pull

# 2. Install dependencies
npm install

# 3. Run migrations
npm run db:migrate

# 4. Build
npm run build

# 5. Restart production server
npm run build
npm start
```

### Working with Workflows

```bash
# 1. Edit workflows in n8n UI (http://localhost:5678)

# 2. Pull changes to local files
npm run workflow:sync-pull

# 3. Commit workflow files
git add workflows/
git commit -m "Update workflows"

# On another machine, push workflows back to n8n
npm run workflow:sync-push
```

## 📚 Additional Resources

- [Deployment Setup Guide](./DEPLOYMENT_SETUP.md) - Docker architecture and configurations
- [Local Development Guide](./LOCAL-DEVELOPMENT.md) - Development environment setup
- [Database Reset Guide](./DATABASE_RESET.md) - Database management

## 🐛 Debug Mode

For more verbose logging:

```bash
# Start with full console output
tsx scripts/manageDevStack.ts up

# Docker compose with debug
docker compose -f docker-compose.dev.yml --verbose up

# Check container resource usage
docker stats
```

## 🎨 Script Customization

All scripts are in the `scripts/` directory and written in TypeScript. You can modify them or create new ones:

```bash
scripts/
  ├── manageDevStack.ts      # Dev environment management
  ├── manageComposeStack.ts  # Production stack management
  ├── checkServices.ts       # Health checks
  ├── preDev.ts             # Pre-development checks
  ├── runMigrations.ts      # Database migrations
  └── n8nSync.ts            # Workflow synchronization
```

Run any script directly:
```bash
tsx scripts/checkServices.ts
tsx scripts/manageDevStack.ts --help
```

