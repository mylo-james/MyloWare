# Scripts Cheat Sheet 🚀

Quick reference for the most commonly used commands.

## Most Common Commands

```bash
# Check if everything is running
npm run services:check

# Start dev environment
npm run dev:up

# Stop dev environment
npm run dev:down

# View logs
npm run dev:logs

# Restart a service
npm run dev:restart n8n
```

## Development Workflow

```bash
# 1️⃣ Start services
npm run dev:up

# 2️⃣ Check health
npm run services:check

# 3️⃣ Start MCP server (in another terminal)
npm run dev

# 4️⃣ Access n8n
open http://localhost:5678
```

## Quick Fixes

```bash
# Service not responding?
npm run dev:restart

# Still broken?
npm run dev:down
npm run dev:up

# Nuclear option (removes all data)
npm run dev:clean
npm run dev:up
```

## Database

```bash
# Run migrations
npm run db:migrate

# Browse database
npm run db:studio
```

## n8n Workflows

```bash
# Pull from n8n → local files
npm run workflow:sync-pull

# Push from local files → n8n
npm run workflow:sync-push

# Validate workflows and tool specs
npm run workflow:validate
```

## Testing & QA

```bash
# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format
```

## Service URLs

- **n8n**: http://localhost:5678
- **n8n (web)**: https://n8n.mjames.dev
- **MCP Health**: http://localhost:3456/health
- **MCP Metrics**: http://localhost:3456/metrics

## Docker Compose Files

- `docker-compose.dev.yml` - Development environment (n8n + databases)
- `docker-compose.yml` - Production MCP server

## Container Names

```
mcp-prompts-n8n-1            # n8n workflow engine
mcp-prompts-n8n-postgres-1   # n8n database (port 5433)
mcp-prompts-mcp-postgres-1   # MCP database (port 5432)
mcp-prompts-cloudflared-1    # Cloudflare tunnel
```

## Manual Docker Commands

```bash
# List containers
docker ps

# View logs
docker logs -f mcp-prompts-n8n-1

# Restart container
docker restart mcp-prompts-n8n-1

# Execute command in container
docker exec -it mcp-prompts-n8n-1 sh
```

## Troubleshooting

| Problem                     | Solution                                   |
| --------------------------- | ------------------------------------------ |
| Can't access localhost:5678 | `npm run dev:restart n8n`                  |
| Port already in use         | `npm run dev:down` then check `docker ps`  |
| Database connection errors  | `npm run db:migrate`                       |
| Workflow not loading        | `npm run workflow:sync-pull` then `npm run workflow:sync-push` |
| Everything is broken        | `npm run dev:clean && npm run dev:up`      |

## Full Documentation

See [docs/SCRIPTS_GUIDE.md](./docs/SCRIPTS_GUIDE.md) for complete documentation.
